import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { containsLikelySecretValue } from "./capture-policy.js";
import {
  type Checkpoint,
  type ConflictNotice,
  ENTRY_TYPES,
  type EntryInput,
  JOURNAL_SCHEMA_VERSION,
  type JournalEntry,
  type JournalSession,
  JournalValidationError,
  type NoticeResolution,
  normalizeEntryInput,
  validateCheckpointShape,
} from "./domain.js";

const MAX_SESSION_BYTES = 10 * 1024 * 1024;
const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;

export interface JournalStorageFileSystem {
  writeFile: (path: string, value: string) => void;
  chmod: (path: string, mode: number) => void;
  syncPath: (path: string) => void;
  rename: (from: string, to: string) => void;
  unlink: (path: string) => void;
}

function syncPath(path: string): void {
  if (process.platform === "win32") return;
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export const DEFAULT_JOURNAL_FILE_SYSTEM: JournalStorageFileSystem = {
  writeFile: (path, value) => writeFileSync(path, value, { encoding: "utf8", mode: 0o600 }),
  chmod: (path, mode) => {
    if (process.platform !== "win32") chmodSync(path, mode);
  },
  syncPath,
  rename: renameSync,
  unlink: unlinkSync,
};

export interface JournalStorageOptions {
  clock?: () => string;
  homeDir?: string;
  maxBytes?: number;
  maxLines?: number;
  fileSystem?: JournalStorageFileSystem;
}

interface StoredEnvelope extends Omit<JournalSession, "fingerprint"> {
  fingerprint: string;
}

export interface SessionListPage {
  sessions: Array<{ sessionId: string; updatedAt: string; closedAt: string | null }>;
  nextCursor: string | null;
  diagnostics: Array<{ code: "invalid_session"; sessionId: string; message: string }>;
}

function fingerprintFor(value: Omit<JournalSession, "fingerprint">): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validateSessionId(sessionId: string): string {
  const normalized = sessionId.trim();
  if (!SESSION_ID_PATTERN.test(normalized)) throw new JournalValidationError("invalid journal session id");
  return normalized;
}

function safeFileSystemError(stage: string, error: unknown): Error {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code === "string" && code) {
    return new JournalValidationError(`journal filesystem ${stage} failed (${code})`);
  }
  return error instanceof Error ? error : new JournalValidationError(`journal filesystem ${stage} failed`);
}

export class JournalStorage {
  readonly storageDir: string;
  private readonly sessionsDir: string;
  private readonly clock: () => string;
  private readonly maxBytes: number;
  private readonly maxLines: number;
  private readonly fileSystem: JournalStorageFileSystem;
  private readonly observedFingerprints = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(storageDir = join(homedir(), ".pi_agent_journal"), options: JournalStorageOptions = {}) {
    const resolved = resolve(storageDir);
    if (basename(resolved) === ".mcp_sequential_thinking" || resolved.includes("/.mcp_sequential_thinking/")) {
      throw new JournalValidationError("legacy Sequential Thinking storage is not supported");
    }
    try {
      if (lstatSync(resolved).isSymbolicLink()) {
        throw new JournalValidationError("journal storage directory cannot be a symlink");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.storageDir = resolved;
    this.sessionsDir = join(resolved, "sessions");
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.maxBytes = options.maxBytes ?? MAX_SESSION_BYTES;
    this.maxLines = options.maxLines ?? Number.MAX_SAFE_INTEGER;
    this.fileSystem = options.fileSystem ?? DEFAULT_JOURNAL_FILE_SYSTEM;
    this.ensureDir(this.storageDir);
    this.ensureDir(this.sessionsDir);
  }

  async createSession(sessionId: string): Promise<JournalSession> {
    return this.mutate(async () => {
      const id = validateSessionId(sessionId);
      const path = this.sessionPath(id);
      if (existsSync(path)) throw new JournalValidationError(`journal session '${id}' already exists`);
      const now = this.clock();
      return this.writeSession({
        schemaVersion: JOURNAL_SCHEMA_VERSION,
        sessionId: id,
        entries: [],
        checkpoints: [],
        notices: [],
        noticeResolutions: [],
        activeCheckpointId: null,
        closedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  async getSession(sessionId: string): Promise<JournalSession> {
    await this.queue;
    return this.readSession(validateSessionId(sessionId));
  }

  async listSessions(): Promise<Array<{ sessionId: string; updatedAt: string; closedAt: string | null }>> {
    return (await this.listSessionsPage({ limit: 100 })).sessions;
  }

  async listSessionsPage(options: { cursor?: string; limit?: number } = {}): Promise<SessionListPage> {
    await this.queue;
    const names = readdirSync(this.sessionsDir)
      .filter((name) => name.endsWith(".json"))
      .sort();
    const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
    const start = this.decodeCursor(options.cursor);
    if (start > names.length) throw new JournalValidationError("invalid session cursor");
    const sessions: SessionListPage["sessions"] = [];
    const diagnostics: SessionListPage["diagnostics"] = [];
    let index = start;
    while (index < names.length && sessions.length < limit) {
      const name = names[index];
      index += 1;
      const sessionId = name.slice(0, -5);
      try {
        const { updatedAt, closedAt } = this.readSession(sessionId);
        sessions.push({ sessionId, updatedAt, closedAt });
      } catch (error) {
        diagnostics.push({
          code: "invalid_session",
          sessionId,
          message: error instanceof Error ? error.message : "invalid journal session",
        });
      }
    }
    return {
      sessions,
      nextCursor: index < names.length ? Buffer.from(String(index), "utf8").toString("base64url") : null,
      diagnostics,
    };
  }

  async appendEntries(sessionId: string, entries: JournalEntry[]): Promise<JournalSession> {
    return this.mutate(async () => {
      const session = this.readSession(validateSessionId(sessionId));
      this.assertOpen(session);
      const existing = new Set(session.entries.map((entry) => entry.id));
      for (const entry of entries) {
        if (existing.has(entry.id)) throw new JournalValidationError(`duplicate entry id '${entry.id}'`);
        existing.add(entry.id);
      }
      return this.writeSession({
        ...this.withoutFingerprint(session),
        entries: [...session.entries, ...entries],
        updatedAt: this.clock(),
      });
    });
  }

  async saveCheckpoint(sessionId: string, checkpoint: Checkpoint): Promise<JournalSession> {
    return this.mutate(async () => {
      const session = this.readSession(validateSessionId(sessionId));
      this.assertOpen(session);
      if (session.checkpoints.some((candidate) => candidate.id === checkpoint.id)) {
        throw new JournalValidationError(`duplicate checkpoint id '${checkpoint.id}'`);
      }
      return this.writeSession({
        ...this.withoutFingerprint(session),
        checkpoints: [...session.checkpoints, checkpoint],
        activeCheckpointId: checkpoint.id,
        updatedAt: this.clock(),
      });
    });
  }

  async appendNotice(sessionId: string, notice: ConflictNotice): Promise<JournalSession> {
    return this.mutate(async () => {
      const session = this.readSession(validateSessionId(sessionId));
      this.assertOpen(session);
      return this.writeSession({
        ...this.withoutFingerprint(session),
        notices: [...session.notices, notice],
        updatedAt: this.clock(),
      });
    });
  }

  async resolveNotices(sessionId: string, affectedIds: string[]): Promise<JournalSession> {
    return this.mutate(async () => {
      const session = this.readSession(validateSessionId(sessionId));
      this.assertOpen(session);
      const affected = new Set(affectedIds);
      const alreadyResolved = new Set(session.noticeResolutions.map((resolution) => resolution.noticeId));
      const resolutions: NoticeResolution[] = session.notices
        .filter(
          (notice) =>
            notice.requiresJudgment &&
            !alreadyResolved.has(notice.id) &&
            notice.affectedIds.some((id) => affected.has(id)),
        )
        .map((notice) => ({
          id: `resolution-${randomUUID()}`,
          noticeId: notice.id,
          affectedIds: notice.affectedIds.filter((id) => affected.has(id)),
          createdAt: this.clock(),
        }));
      if (resolutions.length === 0) return session;
      return this.writeSession({
        ...this.withoutFingerprint(session),
        noticeResolutions: [...session.noticeResolutions, ...resolutions],
        updatedAt: this.clock(),
      });
    });
  }

  async closeSession(sessionId: string): Promise<JournalSession> {
    return this.mutate(async () => {
      const session = this.readSession(validateSessionId(sessionId));
      if (session.closedAt) return session;
      const now = this.clock();
      return this.writeSession({ ...this.withoutFingerprint(session), closedAt: now, updatedAt: now });
    });
  }

  async finalizeSession(
    sessionId: string,
    createFinalCheckpoint: (session: JournalSession) => Checkpoint,
  ): Promise<JournalSession> {
    return this.mutate(async () => {
      const session = this.readSession(validateSessionId(sessionId));
      if (session.closedAt) return session;
      const checkpoint = createFinalCheckpoint(structuredClone(session));
      if (session.checkpoints.some((candidate) => candidate.id === checkpoint.id)) {
        throw new JournalValidationError(`duplicate checkpoint id '${checkpoint.id}'`);
      }
      const now = this.clock();
      return this.writeSession({
        ...this.withoutFingerprint(session),
        checkpoints: [...session.checkpoints, checkpoint],
        activeCheckpointId: checkpoint.id,
        closedAt: now,
        updatedAt: now,
      });
    });
  }

  private decodeCursor(cursor: string | undefined): number {
    if (cursor === undefined) return 0;
    try {
      const decoded = Buffer.from(cursor, "base64url").toString("utf8");
      if (!/^\d+$/.test(decoded)) throw new Error("invalid");
      return Number(decoded);
    } catch {
      throw new JournalValidationError("invalid session cursor");
    }
  }

  private mutate<T>(fn: () => Promise<T>): Promise<T> {
    const operation = this.queue.then(fn, fn);
    this.queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private sessionPath(sessionId: string): string {
    return join(this.sessionsDir, `${validateSessionId(sessionId)}.json`);
  }

  private readSession(sessionId: string): JournalSession {
    const path = this.sessionPath(sessionId);
    if (!existsSync(path)) throw new JournalValidationError(`journal session '${sessionId}' does not exist`);
    if (lstatSync(path).isSymbolicLink()) throw new JournalValidationError("journal session file cannot be a symlink");
    const stats = statSync(path);
    if (!stats.isFile() || stats.size > this.maxBytes)
      throw new JournalValidationError("invalid journal session file: byte limit exceeded");
    try {
      const raw = readFileSync(path, "utf8");
      if (raw.split("\n").length > this.maxLines) throw new Error("line limit exceeded");
      const parsed = JSON.parse(raw) as StoredEnvelope;
      if (parsed.schemaVersion !== JOURNAL_SCHEMA_VERSION || parsed.sessionId !== sessionId) {
        throw new Error("schema or session mismatch");
      }
      const { fingerprint, ...content } = parsed;
      if (fingerprintFor(content) !== fingerprint) throw new Error("fingerprint mismatch");
      if (containsLikelySecretValue(parsed)) throw new Error("detected credential in journal candidate");
      this.validateEnvelope(parsed, sessionId);
      const observed = this.observedFingerprints.get(sessionId);
      if (observed && observed !== fingerprint) throw new Error("session changed outside this writer");
      this.observedFingerprints.set(sessionId, fingerprint);
      return structuredClone(parsed);
    } catch (error) {
      const safe = safeFileSystemError("read", error);
      throw new JournalValidationError(`invalid journal session '${sessionId}': ${safe.message}`);
    }
  }

  private writeSession(session: Omit<JournalSession, "fingerprint">): JournalSession {
    if (containsLikelySecretValue(session)) {
      throw new JournalValidationError("detected credential; journal candidate was not persisted");
    }
    const fingerprint = fingerprintFor(session);
    const envelope: StoredEnvelope = { ...session, fingerprint };
    const encoded = JSON.stringify(envelope, null, 2);
    if (Buffer.byteLength(encoded, "utf8") > this.maxBytes) {
      throw new JournalValidationError("journal session exceeds byte limit");
    }
    if (encoded.split("\n").length > this.maxLines) {
      throw new JournalValidationError("journal session exceeds line limit");
    }
    const path = this.sessionPath(session.sessionId);
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
      throw new JournalValidationError("journal session file cannot be a symlink");
    }
    const temp = `${path}.tmp.${process.pid}.${randomUUID()}`;
    let published = false;
    let stage = "write";
    try {
      this.fileSystem.writeFile(temp, encoded);
      stage = "temporary chmod";
      this.fileSystem.chmod(temp, 0o600);
      stage = "temporary sync";
      this.fileSystem.syncPath(temp);
      stage = "publish rename";
      this.fileSystem.rename(temp, path);
      published = true;
      stage = "destination chmod";
      this.fileSystem.chmod(path, 0o600);
      stage = "directory sync";
      this.fileSystem.syncPath(this.sessionsDir);
      this.observedFingerprints.set(session.sessionId, fingerprint);
      return structuredClone(envelope);
    } catch (error) {
      try {
        this.fileSystem.unlink(temp);
      } catch {}
      if (published) this.observedFingerprints.set(session.sessionId, fingerprint);
      throw safeFileSystemError(stage, error);
    }
  }

  private validateEnvelope(value: StoredEnvelope, expectedSessionId: string): void {
    if (
      value.sessionId !== expectedSessionId ||
      !Array.isArray(value.entries) ||
      !Array.isArray(value.checkpoints) ||
      !Array.isArray(value.notices) ||
      !Array.isArray(value.noticeResolutions) ||
      typeof value.createdAt !== "string" ||
      !value.createdAt ||
      typeof value.updatedAt !== "string" ||
      !value.updatedAt ||
      (value.closedAt !== null && (typeof value.closedAt !== "string" || !value.closedAt))
    ) {
      throw new JournalValidationError("invalid journal envelope shape");
    }
    const entriesById = new Map<string, JournalEntry>();
    for (const candidate of value.entries as unknown[]) {
      if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
        throw new JournalValidationError("invalid journal entry shape");
      }
      const record = candidate as Record<string, unknown>;
      if (
        !ENTRY_TYPES.includes(record.type as JournalEntry["type"]) ||
        typeof record.timestamp !== "string" ||
        !record.timestamp
      ) {
        throw new JournalValidationError("invalid journal entry shape");
      }
      const normalized = normalizeEntryInput(record as unknown as EntryInput, {
        id: record.id as string,
        timestamp: record.timestamp,
      });
      if (JSON.stringify(normalized) !== JSON.stringify(candidate) || entriesById.has(normalized.id)) {
        throw new JournalValidationError("invalid or duplicate journal entry");
      }
      entriesById.set(normalized.id, normalized);
    }
    for (const entry of entriesById.values()) {
      for (const relationship of entry.relationships) {
        if (!entriesById.has(relationship.targetEntryId)) {
          throw new JournalValidationError("journal relationship references an absent entry");
        }
      }
      if (entry.dependencies.some((dependency) => dependency.originatingEntryId !== entry.id)) {
        throw new JournalValidationError("journal dependency origin mismatch");
      }
    }
    const checkpointsById = new Map<string, Checkpoint>();
    for (const candidate of value.checkpoints as unknown[]) {
      const checkpoint = validateCheckpointShape(candidate);
      if (JSON.stringify(checkpoint) !== JSON.stringify(candidate) || checkpointsById.has(checkpoint.id)) {
        throw new JournalValidationError("invalid or duplicate checkpoint");
      }
      for (const id of checkpoint.supportEntryIds) {
        if (!entriesById.has(id)) throw new JournalValidationError("checkpoint references an absent entry");
      }
      for (const id of checkpoint.settledDecisionEntryIds) {
        if (entriesById.get(id)?.type !== "decision")
          throw new JournalValidationError("checkpoint decision type mismatch");
      }
      for (const id of checkpoint.evidenceEntryIds) {
        const type = entriesById.get(id)?.type;
        if (type !== "evidence" && type !== "validation") {
          throw new JournalValidationError("checkpoint evidence type mismatch");
        }
      }
      if (checkpoint.nextActionEntryId && entriesById.get(checkpoint.nextActionEntryId)?.type !== "next_action") {
        throw new JournalValidationError("checkpoint next action type mismatch");
      }
      if (checkpoint.artifactDependencies.some((dependency) => !entriesById.has(dependency.originatingEntryId))) {
        throw new JournalValidationError("checkpoint dependency references an absent entry");
      }
      checkpointsById.set(checkpoint.id, checkpoint);
    }
    if (value.activeCheckpointId !== null && !checkpointsById.has(value.activeCheckpointId)) {
      throw new JournalValidationError("active checkpoint does not exist");
    }
    const noticeIds = new Set<string>();
    for (const notice of value.notices as unknown[]) {
      if (typeof notice !== "object" || notice === null || Array.isArray(notice)) {
        throw new JournalValidationError("invalid notice shape");
      }
      const record = notice as Record<string, unknown>;
      if (
        typeof record.id !== "string" ||
        !record.id ||
        noticeIds.has(record.id) ||
        !["stale", "missing", "unverifiable", "conflict", "credential", "ambiguity"].includes(
          record.category as string,
        ) ||
        typeof record.safeSummary !== "string" ||
        !record.safeSummary ||
        !Array.isArray(record.affectedIds) ||
        record.affectedIds.some((id) => typeof id !== "string" || !id) ||
        typeof record.requiresJudgment !== "boolean" ||
        typeof record.createdAt !== "string" ||
        !record.createdAt
      ) {
        throw new JournalValidationError("invalid notice shape");
      }
      noticeIds.add(record.id);
    }
    const resolvedNoticeIds = new Set<string>();
    for (const resolution of value.noticeResolutions as unknown[]) {
      if (typeof resolution !== "object" || resolution === null || Array.isArray(resolution)) {
        throw new JournalValidationError("invalid notice resolution shape");
      }
      const record = resolution as Record<string, unknown>;
      if (
        typeof record.id !== "string" ||
        !record.id ||
        typeof record.noticeId !== "string" ||
        !noticeIds.has(record.noticeId) ||
        resolvedNoticeIds.has(record.noticeId) ||
        !Array.isArray(record.affectedIds) ||
        record.affectedIds.some((id) => typeof id !== "string" || !id) ||
        typeof record.createdAt !== "string" ||
        !record.createdAt
      ) {
        throw new JournalValidationError("invalid notice resolution shape");
      }
      resolvedNoticeIds.add(record.noticeId);
    }
  }

  private assertOpen(session: JournalSession): void {
    if (session.closedAt) throw new JournalValidationError("journal session is closed");
  }

  private withoutFingerprint(session: JournalSession): Omit<JournalSession, "fingerprint"> {
    const { fingerprint: _fingerprint, ...value } = session;
    return value;
  }

  private ensureDir(path: string): void {
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
      throw new JournalValidationError("journal storage directory cannot be a symlink");
    }
    mkdirSync(path, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") chmodSync(path, 0o700);
  }
}
