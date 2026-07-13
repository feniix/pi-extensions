import { createHash, randomUUID } from "node:crypto";
import { constants, lstatSync, realpathSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { containsLikelySecretValue } from "./capture-policy.js";
import {
  type Checkpoint,
  type ConflictNotice,
  type EntryInput,
  type FileDependency,
  type FreshnessDependency,
  type JournalEntry,
  type JournalSession,
  JournalValidationError,
  MAX_CHECKPOINT_BYTES,
  MAX_CHECKPOINT_ITEMS,
  normalizeEntryInput,
  validateCheckpointShape,
} from "./domain.js";
import type { JournalStorage } from "./storage.js";

const MAX_HASH_BYTES = 2 * 1024 * 1024;
export interface JournalServiceOptions {
  storage: JournalStorage;
  workspaceRoot: string;
  clock?: () => string;
  idGenerator?: () => string;
  repositoryStateProvider?: () => Promise<string | null>;
  toolVersionProvider?: (tool: string) => Promise<string | null>;
  freshnessTimeoutMs?: number;
  maxEntryBytes?: number;
  maxCheckpointBytes?: number;
}

export interface CheckpointDraft {
  id?: string;
  objective: string;
  status: string;
  settledDecisionEntryIds?: string[];
  openQuestions?: string[];
  evidenceEntryIds?: string[];
  artifactDependencies?: FreshnessDependency[];
  nextActionEntryId?: string | null;
  /** Internal/runtime-only extra semantic references included in compact support. */
  supportEntryIds?: string[];
}

export interface FreshnessResult {
  dependency: FreshnessDependency;
  status: "fresh" | "stale" | "missing" | "unverifiable";
}

export class JournalService {
  private readonly storage: JournalStorage;
  private readonly workspaceRoot: string;
  private readonly workspaceId: string;
  private readonly clock: () => string;
  private readonly idGenerator: () => string;
  private readonly repositoryStateProvider: () => Promise<string | null>;
  private readonly toolVersionProvider: (tool: string) => Promise<string | null>;
  private readonly freshnessTimeoutMs: number;
  private readonly maxEntryBytes: number;
  private readonly maxCheckpointBytes: number;

  constructor(options: JournalServiceOptions) {
    this.storage = options.storage;
    this.workspaceRoot = realpathSync(resolve(options.workspaceRoot));
    this.workspaceId = createHash("sha256").update(this.workspaceRoot).digest("hex");
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.repositoryStateProvider = options.repositoryStateProvider ?? (async () => null);
    this.toolVersionProvider = options.toolVersionProvider ?? (async () => null);
    this.freshnessTimeoutMs = options.freshnessTimeoutMs ?? 1_000;
    this.maxEntryBytes = options.maxEntryBytes ?? 20_000;
    this.maxCheckpointBytes = options.maxCheckpointBytes ?? MAX_CHECKPOINT_BYTES;
  }

  async record(sessionId: string, input: EntryInput): Promise<JournalEntry> {
    return (await this.recordBatch(sessionId, [input]))[0];
  }

  async recordBatch(sessionId: string, inputs: EntryInput[]): Promise<JournalEntry[]> {
    if (inputs.length === 0) throw new JournalValidationError("journal record batch must not be empty");
    for (const input of inputs) await this.rejectSecretCandidate(sessionId, input);
    const entries = inputs.map((input) =>
      normalizeEntryInput(input, {
        id: input.id ?? this.idGenerator(),
        timestamp: this.clock(),
        maxEntryBytes: this.maxEntryBytes,
      }),
    );
    for (const entry of entries) {
      await this.rejectSecretCandidate(sessionId, entry);
      if (entry.dependencies.some((dependency) => dependency.originatingEntryId !== entry.id)) {
        throw new JournalValidationError("entry dependency must reference its originating entry");
      }
    }
    const session = await this.storage.getSession(sessionId);
    const byId = new Map(session.entries.map((candidate) => [candidate.id, candidate]));
    for (const entry of entries) {
      if (byId.has(entry.id)) throw new JournalValidationError(`duplicate entry id '${entry.id}'`);
      byId.set(entry.id, entry);
    }
    for (const entry of entries) {
      for (const relationship of entry.relationships) {
        const target = byId.get(relationship.targetEntryId);
        if (!target) {
          throw new JournalValidationError(`relationship target '${relationship.targetEntryId}' does not exist`);
        }
        if (relationship.type === "supersedes" && this.reaches(entry.id, target, byId)) {
          throw new JournalValidationError("supersedes relationship would create a cycle");
        }
      }
    }
    await this.storage.appendEntries(sessionId, entries);
    return entries;
  }

  async inspectHistory(sessionId: string): Promise<JournalEntry[]> {
    return (await this.storage.getSession(sessionId)).entries;
  }

  async inspectCurrent(
    sessionId: string,
  ): Promise<{ settledEntries: JournalEntry[]; unresolvedAlternatives: string[][] }> {
    const entries = (await this.storage.getSession(sessionId)).entries;
    const superseded = new Set(
      entries.flatMap((entry) =>
        entry.relationships
          .filter((relationship) => relationship.type === "supersedes")
          .map((item) => item.targetEntryId),
      ),
    );
    const alternativePairs = new Map<string, string[]>();
    const resolvedAlternativeIds = new Set<string>();
    for (const entry of entries) {
      for (const relationship of entry.relationships.filter((item) => item.type === "alternative-to")) {
        const settlesExistingPair =
          (entry.type === "decision" || entry.type === "rejected_alternative") &&
          [...alternativePairs.values()].some((pair) => pair.includes(relationship.targetEntryId));
        const pair = [entry.id, relationship.targetEntryId].sort();
        alternativePairs.set(pair.join(":"), pair);
        if (settlesExistingPair) resolvedAlternativeIds.add(relationship.targetEntryId);
      }
    }
    return {
      settledEntries: entries.filter((entry) => !superseded.has(entry.id)),
      unresolvedAlternatives: [...alternativePairs.values()].filter((pair) =>
        pair.every((id) => !superseded.has(id) && !resolvedAlternativeIds.has(id)),
      ),
    };
  }

  async createCheckpoint(sessionId: string, draft: CheckpointDraft): Promise<Checkpoint> {
    await this.rejectSecretCandidate(sessionId, draft);
    const session = await this.storage.getSession(sessionId);
    const checkpoint = this.buildCheckpoint(session, draft);
    await this.rejectSecretCandidate(sessionId, checkpoint);
    const active = session.checkpoints.find((candidate) => candidate.id === session.activeCheckpointId);
    if (active && this.sameCheckpointState(active, checkpoint)) return active;
    await this.storage.saveCheckpoint(sessionId, checkpoint);
    return checkpoint;
  }

  async closeSession(sessionId: string): Promise<JournalSession> {
    return this.storage.finalizeSession(sessionId, (session) => {
      const superseded = new Set(
        session.entries.flatMap((entry) =>
          entry.relationships
            .filter((relationship) => relationship.type === "supersedes")
            .map((relationship) => relationship.targetEntryId),
        ),
      );
      const settledEntries = session.entries.filter((entry) => !superseded.has(entry.id));
      const active = session.checkpoints.find((candidate) => candidate.id === session.activeCheckpointId);
      const openQuestions = (active?.openQuestions ?? []).slice(-MAX_CHECKPOINT_ITEMS);
      const dependencies = (active?.artifactDependencies ?? []).slice(
        -Math.max(0, MAX_CHECKPOINT_ITEMS - openQuestions.length),
      );
      const semanticCapacity = Math.max(0, MAX_CHECKPOINT_ITEMS - openQuestions.length - dependencies.length);
      let support = settledEntries.slice(-semanticCapacity);
      while (true) {
        const supportEntryIds = support.map((entry) => entry.id);
        try {
          return this.buildCheckpoint(session, {
            objective: active?.objective ?? "Closed journal session",
            status: "closed",
            settledDecisionEntryIds: support.filter((entry) => entry.type === "decision").map((entry) => entry.id),
            openQuestions,
            evidenceEntryIds: support
              .filter((entry) => entry.type === "evidence" || entry.type === "validation")
              .map((entry) => entry.id),
            artifactDependencies: dependencies,
            nextActionEntryId: [...support].reverse().find((entry) => entry.type === "next_action")?.id ?? null,
            supportEntryIds,
          });
        } catch (error) {
          if (
            !(error instanceof JournalValidationError) ||
            !/byte limit/i.test(error.message) ||
            support.length === 0
          ) {
            throw error;
          }
          support = support.slice(1);
        }
      }
    });
  }

  async resume(sessionId: string): Promise<{
    checkpoint: Checkpoint | null;
    entries: JournalEntry[];
    freshness: FreshnessResult[];
    notices: ConflictNotice[];
  }> {
    const session = await this.storage.getSession(sessionId);
    const checkpoint = session.checkpoints.find((candidate) => candidate.id === session.activeCheckpointId) ?? null;
    if (!checkpoint) return { checkpoint: null, entries: [], freshness: [], notices: session.notices };
    const entriesById = new Map(session.entries.map((entry) => [entry.id, entry]));
    const entries = checkpoint.supportEntryIds.flatMap((id) => {
      const entry = entriesById.get(id);
      return entry ? [entry] : [];
    });
    const freshness = await Promise.all(
      checkpoint.artifactDependencies.map((dependency) => this.verifyDependency(dependency)),
    );
    let notices = this.projectNotices(session);
    const unusableEntryIds = new Set(
      freshness
        .filter((result) => result.dependency.material && result.status !== "fresh")
        .map((result) => result.dependency.originatingEntryId),
    );
    for (const result of freshness) {
      if (!result.dependency.material || result.status === "fresh") continue;
      const affectedIds = [result.dependency.originatingEntryId];
      const alreadyRecorded = notices.some(
        (notice) => notice.category === result.status && notice.affectedIds.includes(affectedIds[0]),
      );
      if (alreadyRecorded) continue;
      const notice: ConflictNotice = {
        id: this.idGenerator(),
        category: result.status,
        safeSummary: `Material ${result.dependency.kind} dependency is ${result.status}`,
        affectedIds,
        requiresJudgment: true,
        createdAt: this.clock(),
      };
      await this.storage.appendNotice(sessionId, notice);
      notices = [...notices, notice];
    }
    const resolvableIds = notices
      .filter(
        (notice) =>
          notice.requiresJudgment &&
          notice.affectedIds.length > 0 &&
          (notice.category === "stale" || notice.category === "missing" || notice.category === "unverifiable") &&
          notice.affectedIds.every((id) => !unusableEntryIds.has(id)),
      )
      .flatMap((notice) => notice.affectedIds);
    if (resolvableIds.length > 0) {
      await this.storage.resolveNotices(sessionId, resolvableIds);
      notices = this.projectNotices(await this.storage.getSession(sessionId));
    }
    return {
      checkpoint,
      entries: entries.filter((entry) => !unusableEntryIds.has(entry.id)),
      freshness,
      notices,
    };
  }

  async inspectNotices(sessionId: string): Promise<ConflictNotice[]> {
    return this.projectNotices(await this.storage.getSession(sessionId));
  }

  private projectNotices(session: JournalSession): ConflictNotice[] {
    const resolved = new Set(session.noticeResolutions.map((resolution) => resolution.noticeId));
    return session.notices.map((notice) =>
      resolved.has(notice.id) && notice.requiresJudgment ? { ...notice, requiresJudgment: false } : notice,
    );
  }

  toWorkspaceRelativePath(path: string): string {
    const absolute = resolve(this.workspaceRoot, path);
    if (absolute !== this.workspaceRoot && !absolute.startsWith(`${this.workspaceRoot}${sep}`)) {
      throw new JournalValidationError("artifact path escapes workspace");
    }
    const normalized = relative(this.workspaceRoot, absolute).replaceAll("\\", "/");
    if (!normalized || Buffer.byteLength(normalized, "utf8") > 512) {
      throw new JournalValidationError("artifact path is invalid or exceeds byte limit");
    }
    return normalized;
  }

  async observeFileDependency(path: string, originatingEntryId: string, material: boolean): Promise<FileDependency> {
    const { path: safePath, bytes } = await this.readSafeFile(path);
    return {
      kind: "file",
      path: relative(this.workspaceRoot, safePath),
      workspaceId: this.workspaceId,
      observedHash: createHash("sha256").update(bytes).digest("hex"),
      observedAt: this.clock(),
      originatingEntryId,
      material,
    };
  }

  async verifyDependency(dependency: FreshnessDependency): Promise<FreshnessResult> {
    switch (dependency.kind) {
      case "repository_state": {
        try {
          const current = await this.withFreshnessTimeout(this.repositoryStateProvider());
          return {
            dependency,
            status: current === null ? "unverifiable" : current === dependency.value ? "fresh" : "stale",
          };
        } catch {
          return { dependency, status: "unverifiable" };
        }
      }
      case "tool_version": {
        try {
          const current = await this.withFreshnessTimeout(this.toolVersionProvider(dependency.tool));
          return {
            dependency,
            status: current === null ? "unverifiable" : current === dependency.version ? "fresh" : "stale",
          };
        } catch {
          return { dependency, status: "unverifiable" };
        }
      }
      case "external":
        return {
          dependency,
          status: Date.parse(this.clock()) < Date.parse(dependency.revalidateAfter) ? "fresh" : "unverifiable",
        };
      case "file":
        if (dependency.workspaceId !== this.workspaceId) return { dependency, status: "unverifiable" };
        try {
          const current = createHash("sha256")
            .update((await this.readSafeFile(dependency.path)).bytes)
            .digest("hex");
          return { dependency, status: current === dependency.observedHash ? "fresh" : "stale" };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const code = (error as NodeJS.ErrnoException).code;
          return {
            dependency,
            status: code === "ENOENT" || /does not exist/i.test(message) ? "missing" : "unverifiable",
          };
        }
    }
  }

  renderHumanText(value: string): string {
    let result = "";
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code === 0x1b) {
        const introducer = value[index + 1];
        if (introducer === "]") {
          index += 2;
          while (index < value.length && value.charCodeAt(index) !== 0x07) index += 1;
        } else if (introducer === "[") {
          index += 2;
          while (index < value.length && (value.charCodeAt(index) < 0x40 || value.charCodeAt(index) > 0x7e)) {
            index += 1;
          }
        }
        continue;
      }
      if ((code < 0x20 && code !== 0x09 && code !== 0x0a) || code === 0x7f) continue;
      result += value[index];
    }
    return result;
  }

  private buildCheckpoint(session: JournalSession, draft: CheckpointDraft): Checkpoint {
    const entriesById = new Map(session.entries.map((entry) => [entry.id, entry]));
    const entryIds = new Set(entriesById.keys());
    const settledDecisionEntryIds = draft.settledDecisionEntryIds ?? [];
    const evidenceEntryIds = draft.evidenceEntryIds ?? [];
    const nextActionEntryId = draft.nextActionEntryId ?? null;
    const supportEntryIds = [
      ...new Set([
        ...settledDecisionEntryIds,
        ...evidenceEntryIds,
        ...(nextActionEntryId ? [nextActionEntryId] : []),
        ...(draft.supportEntryIds ?? []),
      ]),
    ];
    for (const id of supportEntryIds) {
      if (!entryIds.has(id)) throw new JournalValidationError(`checkpoint support entry '${id}' does not exist`);
    }
    for (const id of settledDecisionEntryIds) {
      if (entriesById.get(id)?.type !== "decision") {
        throw new JournalValidationError(`checkpoint settled decision must reference a decision entry: '${id}'`);
      }
    }
    for (const id of evidenceEntryIds) {
      const type = entriesById.get(id)?.type;
      if (type !== "evidence" && type !== "validation") {
        throw new JournalValidationError(`checkpoint evidence must reference an evidence or validation entry: '${id}'`);
      }
    }
    if (nextActionEntryId && entriesById.get(nextActionEntryId)?.type !== "next_action") {
      throw new JournalValidationError(
        `checkpoint next action must reference a next_action entry: '${nextActionEntryId}'`,
      );
    }
    for (const dependency of draft.artifactDependencies ?? []) {
      if (!entryIds.has(dependency.originatingEntryId)) {
        throw new JournalValidationError(
          `checkpoint dependency entry '${dependency.originatingEntryId}' does not exist`,
        );
      }
    }
    const checkpoint = validateCheckpointShape({
      id: draft.id ?? this.idGenerator(),
      objective: draft.objective.trim(),
      status: draft.status.trim(),
      settledDecisionEntryIds,
      openQuestions: draft.openQuestions ?? [],
      evidenceEntryIds,
      artifactDependencies: draft.artifactDependencies ?? [],
      nextActionEntryId,
      supportEntryIds,
      createdAt: this.clock(),
    });
    const itemCount =
      checkpoint.supportEntryIds.length + checkpoint.openQuestions.length + checkpoint.artifactDependencies.length;
    if (itemCount > MAX_CHECKPOINT_ITEMS) throw new JournalValidationError("checkpoint exceeds item limit");
    if (Buffer.byteLength(JSON.stringify(checkpoint), "utf8") > this.maxCheckpointBytes) {
      throw new JournalValidationError("checkpoint exceeds byte limit");
    }
    return checkpoint;
  }

  private async withFreshnessTimeout<T>(operation: Promise<T>): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("freshness check timed out")), this.freshnessTimeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private sameCheckpointState(left: Checkpoint, right: Checkpoint): boolean {
    const state = (checkpoint: Checkpoint) => ({
      objective: checkpoint.objective,
      status: checkpoint.status,
      settledDecisionEntryIds: checkpoint.settledDecisionEntryIds,
      openQuestions: checkpoint.openQuestions,
      evidenceEntryIds: checkpoint.evidenceEntryIds,
      artifactDependencies: checkpoint.artifactDependencies,
      nextActionEntryId: checkpoint.nextActionEntryId,
      supportEntryIds: checkpoint.supportEntryIds,
    });
    return JSON.stringify(state(left)) === JSON.stringify(state(right));
  }

  private async readSafeFile(path: string): Promise<{ path: string; bytes: Buffer }> {
    const safePath = this.resolveSafeFile(path);
    const handle = await open(safePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.freshnessTimeoutMs);
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) throw new JournalValidationError("artifact must be a regular file");
      if (stats.size > MAX_HASH_BYTES) throw new JournalValidationError("artifact exceeds hash byte limit");
      return { path: safePath, bytes: await handle.readFile({ signal: controller.signal }) };
    } finally {
      clearTimeout(timeout);
      await handle.close();
    }
  }

  private resolveSafeFile(path: string): string {
    const absolute = resolve(this.workspaceRoot, path);
    if (absolute !== this.workspaceRoot && !absolute.startsWith(`${this.workspaceRoot}${sep}`)) {
      throw new JournalValidationError("artifact path escapes workspace");
    }
    if (!exists(absolute)) throw new JournalValidationError("artifact does not exist");
    const canonical = realpathSync(absolute);
    if (canonical !== this.workspaceRoot && !canonical.startsWith(`${this.workspaceRoot}${sep}`)) {
      throw new JournalValidationError("artifact path escapes workspace");
    }
    if (canonical !== absolute || lstatSync(absolute).isSymbolicLink()) {
      throw new JournalValidationError("artifact symlinks are not supported");
    }
    const stats = statSync(canonical);
    if (!stats.isFile()) throw new JournalValidationError("artifact must be a regular file");
    if (stats.size > MAX_HASH_BYTES) throw new JournalValidationError("artifact exceeds hash byte limit");
    return canonical;
  }

  private reaches(candidateId: string, target: JournalEntry, byId: Map<string, JournalEntry>): boolean {
    const pending = [target];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current || visited.has(current.id)) continue;
      if (current.id === candidateId) return true;
      visited.add(current.id);
      for (const relationship of current.relationships.filter((item) => item.type === "supersedes")) {
        const next = byId.get(relationship.targetEntryId);
        if (next) pending.push(next);
      }
    }
    return false;
  }

  private async rejectSecretCandidate(sessionId: string, candidate: unknown): Promise<void> {
    if (!containsLikelySecretValue(candidate)) return;
    await this.persistSafeNotice(sessionId, "credential", "Detected credential candidate was excluded", []);
    throw new JournalValidationError("detected credential; journal candidate was not persisted");
  }

  private async persistSafeNotice(
    sessionId: string,
    category: ConflictNotice["category"],
    safeSummary: string,
    affectedIds: string[],
  ): Promise<void> {
    await this.storage.appendNotice(sessionId, {
      id: this.idGenerator(),
      category,
      safeSummary,
      affectedIds,
      requiresJudgment: true,
      createdAt: this.clock(),
    });
  }
}

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
