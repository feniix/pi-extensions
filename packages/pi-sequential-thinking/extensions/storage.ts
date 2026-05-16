/**
 * ThoughtStorage - Persistence layer for sequential thinking sessions
 */

import { createHash } from "node:crypto";
import type { Dir } from "node:fs";
import {
  accessSync,
  chmodSync,
  existsSync,
  constants as fsConstants,
  lstatSync,
  mkdirSync,
  opendirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  DEFAULT_HISTORY_LIMIT,
  isRecord,
  MAX_HISTORY_LIMIT,
  MAX_IMPORT_BYTES,
  normalizeSessionId,
  normalizeThoughtRecord,
  SCHEMA_VERSION,
  type SessionInfo,
  STATUS_ENUMERATION_SESSION_THRESHOLD,
  type ThoughtData,
  ThoughtStage,
  ThoughtValidationError,
  thoughtToDict,
} from "./types.js";

// =============================================================================
// Public Types
// =============================================================================

export interface SessionOperationResult {
  sessionId: string | null;
  sessionLabel: string;
  preCount: number;
  postCount: number;
  changed: boolean;
  savedAt: string;
  stateFingerprint: string;
  warnings?: string[];
}

export interface ExportSessionResult extends SessionOperationResult {
  exportedAt: string;
  overwroteExistingFile: boolean;
  filePath: string;
}

export interface ImportSessionResult extends SessionOperationResult {
  importedAt: string;
  embeddedSessionId?: string | null;
  overwroteExistingThoughts: boolean;
}

export interface HistoryRequest {
  sessionId?: string | null;
  limit?: number;
  offset?: number;
  includeFullThoughts?: boolean;
}

export interface HistoryThoughtItem {
  id: string;
  thoughtNumber: number;
  totalThoughts: number;
  nextThoughtNeeded: boolean;
  stage: string;
  tags: string[];
  axiomsUsed: string[];
  assumptionsChallenged: string[];
  timestamp: string;
  thought?: string;
  snippet?: string;
}

export interface ThinkingHistory {
  sessionId: string | null;
  sessionLabel: string;
  totalThoughts: number;
  offset: number;
  limit: number;
  returnedThoughts: number;
  hasMore: boolean;
  thoughts: HistoryThoughtItem[];
}

export interface EffectiveConfigStatus {
  storageDir?: string;
  maxBytes: number;
  maxLines: number;
  sources: {
    storageDir: string;
    maxBytes: string;
    maxLines: string;
  };
}

export interface SessionStatusMetadata {
  sessionId: string | null;
  label: string;
  thoughtCount: number;
  lastUpdated: string | null;
  isDefault: boolean;
  stateFingerprint: string;
  corrupt?: boolean;
  error?: string;
}

export interface ThinkingStatus {
  storageDir: string;
  defaultSessionFile: string;
  pathDisclosure: "home_redacted" | "relative" | "absolute_diagnostic";
  namedSessionCount: number;
  totalThoughts?: number;
  sessions: SessionStatusMetadata[];
  effectiveConfig?: EffectiveConfigStatus;
  writable: boolean;
  backupFiles: string[];
  statusCompleteness: {
    complete: boolean;
    reason?: string;
    inspectedNamedSessions: number;
    namedSessionThreshold: number;
    skippedInvalidNamedSessions?: number;
  };
  schemaVersion: number;
}

interface StoredSession {
  thoughts: ThoughtData[];
  lastUpdated: string | null;
  warnings: string[];
  embeddedSessionId?: string | null;
}

interface ThoughtStorageOptions {
  homeDir?: string;
}

// =============================================================================
// Storage Class
// =============================================================================

export class ThoughtStorage {
  private readonly storageDir: string;
  private readonly currentSessionFile: string;
  private readonly homeDir: string;

  constructor(storageDir?: string, options: ThoughtStorageOptions = {}) {
    this.storageDir = storageDir ? resolve(storageDir) : join(homedir(), ".mcp_sequential_thinking");
    this.homeDir = options.homeDir ? resolve(options.homeDir) : homedir();

    this.ensureDirectory(this.storageDir);
    this.currentSessionFile = join(this.storageDir, "current_session.json");

    // Load default once at startup for compatibility with corrupted-file backup behavior.
    // OS-level errors (EACCES, EMFILE, etc.) must not crash the constructor — the
    // extension should still register so callers can diagnose via get_thinking_status.
    try {
      this.loadSessionFile(this.currentSessionFile, {
        missingAsEmpty: true,
        backupCorrupted: true,
        explicitImport: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[pi-sequential-thinking] Startup load failed for default session: ${message}`);
    }
  }

  // =============================================================================
  // Public API
  // =============================================================================

  addThought(thought: ThoughtData, sessionId?: string | null): SessionOperationResult {
    const session = normalizeSessionId(sessionId);
    const loaded = this.loadSession(session.sessionId);
    const preCount = loaded.thoughts.length;
    const thoughts = [...loaded.thoughts, thought];
    const savedAt = this.saveSession(session.sessionId, thoughts);
    return this.createOperationResult(session, preCount, thoughts.length, thoughts, savedAt, true);
  }

  getAllThoughts(sessionId?: string | null): ThoughtData[] {
    const session = normalizeSessionId(sessionId);
    return [...this.loadSession(session.sessionId).thoughts];
  }

  clearHistory(sessionId?: string | null): SessionOperationResult {
    const session = normalizeSessionId(sessionId);
    const loaded = this.loadSession(session.sessionId);
    const preCount = loaded.thoughts.length;
    const savedAt = this.saveSession(session.sessionId, []);
    return this.createOperationResult(session, preCount, 0, [], savedAt, preCount > 0);
  }

  getHistory(request: HistoryRequest = {}): ThinkingHistory {
    const session = normalizeSessionId(request.sessionId);
    const limit = request.limit ?? DEFAULT_HISTORY_LIMIT;
    const offset = request.offset ?? 0;
    const includeFullThoughts = request.includeFullThoughts ?? true;

    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_LIMIT) {
      throw new Error(`limit must be between 1 and ${MAX_HISTORY_LIMIT}`);
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error("offset must be a non-negative integer");
    }

    this.ensureHistoryFileWithinSizeLimit(this.resolveSessionFile(session.sessionId));
    const thoughts = this.loadSession(session.sessionId).thoughts;
    const selected = thoughts.slice(offset, offset + limit);

    return {
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      totalThoughts: thoughts.length,
      offset,
      limit,
      returnedThoughts: selected.length,
      hasMore: offset + limit < thoughts.length,
      thoughts: selected.map((thought) => this.toHistoryThought(thought, includeFullThoughts)),
    };
  }

  exportSession(filePath: string, sessionId?: string | null): ExportSessionResult {
    if (!filePath?.trim()) {
      throw new Error("file_path is required");
    }
    const session = normalizeSessionId(sessionId);
    const thoughts = this.loadSession(session.sessionId).thoughts;
    const targetPath = this.resolveExternalPath(filePath);
    this.ensureExternalWriteTarget(targetPath);

    const exportedAt = new Date().toISOString();
    const overwroteExistingFile = existsSync(targetPath);
    const data = this.createSessionEnvelope(session, thoughts, exportedAt);
    this.saveToFile(targetPath, data);

    return {
      ...this.createOperationResult(session, thoughts.length, thoughts.length, thoughts, exportedAt, true),
      exportedAt,
      overwroteExistingFile,
      filePath: this.redactPath(targetPath).value,
    };
  }

  importSession(filePath: string, sessionId?: string | null): ImportSessionResult {
    if (!filePath?.trim()) {
      throw new Error("file_path is required");
    }
    const importPath = this.resolveExternalPath(filePath);
    const loaded = this.loadSessionFile(importPath, {
      missingAsEmpty: false,
      backupCorrupted: false,
      explicitImport: true,
    });

    const explicitSession = sessionId === undefined || sessionId === null ? undefined : normalizeSessionId(sessionId);
    const embeddedSession =
      loaded.embeddedSessionId === undefined ? undefined : normalizeSessionId(loaded.embeddedSessionId);
    const targetSession = explicitSession ?? embeddedSession ?? normalizeSessionId(undefined);
    const warnings = [...loaded.warnings];
    if (explicitSession && embeddedSession && explicitSession.sessionId !== embeddedSession.sessionId) {
      warnings.push(
        `Import target session_id '${explicitSession.sessionLabel}' overrides embedded sessionId '${embeddedSession.sessionLabel}'.`,
      );
    }

    const previous = this.loadSession(targetSession.sessionId).thoughts;
    const importedAt = new Date().toISOString();
    const savedAt = this.saveSession(targetSession.sessionId, loaded.thoughts);
    // `changed` should reflect content drift only, not the savedAt timestamp.
    // Compare content fingerprints (which exclude lastUpdated) so re-importing
    // identical content reports changed=false.
    const changed =
      this.contentFingerprintFor(targetSession, previous) !==
      this.contentFingerprintFor(targetSession, loaded.thoughts);
    const result = this.createOperationResult(
      targetSession,
      previous.length,
      loaded.thoughts.length,
      loaded.thoughts,
      savedAt,
      changed,
    );

    return {
      ...result,
      importedAt,
      embeddedSessionId: loaded.embeddedSessionId,
      overwroteExistingThoughts: previous.length > 0,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  getStatus(options: { effectiveConfig?: EffectiveConfigStatus } = {}): ThinkingStatus {
    const namedSessionListing = this.listNamedSessionIds();
    const namedSessionsComplete = !namedSessionListing.overflowed && !namedSessionListing.error;

    const sessions: SessionStatusMetadata[] = [this.getSessionMetadata(null)];
    let skippedInvalidNamedSessions = 0;
    for (const sessionId of namedSessionListing.ids) {
      try {
        normalizeSessionId(sessionId);
        sessions.push(this.getSessionMetadata(sessionId));
      } catch (error) {
        if (error instanceof ThoughtValidationError) {
          skippedInvalidNamedSessions += 1;
          continue;
        }
        throw error;
      }
    }

    const corruptSessionCount = sessions.filter((session) => session.corrupt).length;
    const backupListing = this.listBackupFiles();
    const complete = namedSessionsComplete && backupListing.complete && corruptSessionCount === 0;
    const completenessReasons = [
      namedSessionListing.overflowed
        ? `Named session count exceeds threshold ${STATUS_ENUMERATION_SESSION_THRESHOLD}; status is partial.`
        : undefined,
      namedSessionListing.error ? `Named session enumeration failed: ${namedSessionListing.error}` : undefined,
      backupListing.reason,
      corruptSessionCount > 0
        ? `${corruptSessionCount} session${corruptSessionCount === 1 ? " is" : "s are"} corrupt; totalThoughts excluded.`
        : undefined,
    ].filter((reason): reason is string => Boolean(reason));
    // totalThoughts is omitted whenever enumeration is partial OR any session
    // failed to load: otherwise the sum silently understates content.
    const totalThoughts = complete ? sessions.reduce((sum, session) => sum + session.thoughtCount, 0) : undefined;
    const storageRedaction = this.redactPath(this.storageDir);
    const defaultFileRedaction = this.redactPath(this.currentSessionFile);

    return {
      storageDir: storageRedaction.value,
      defaultSessionFile: defaultFileRedaction.value,
      pathDisclosure: storageRedaction.disclosure,
      namedSessionCount: namedSessionListing.ids.length,
      totalThoughts,
      sessions,
      effectiveConfig: options.effectiveConfig ? this.redactEffectiveConfig(options.effectiveConfig) : undefined,
      writable: this.isWritable(this.storageDir),
      backupFiles: backupListing.files,
      statusCompleteness: {
        complete,
        reason: completenessReasons.length > 0 ? completenessReasons.join(" ") : undefined,
        inspectedNamedSessions: namedSessionListing.ids.length,
        namedSessionThreshold: STATUS_ENUMERATION_SESSION_THRESHOLD,
        skippedInvalidNamedSessions: skippedInvalidNamedSessions || undefined,
      },
      schemaVersion: SCHEMA_VERSION,
    };
  }

  // =============================================================================
  // Session helpers
  // =============================================================================

  private resolveSessionFile(sessionId: string | null): string {
    if (sessionId === null) {
      return this.currentSessionFile;
    }
    return join(this.storageDir, "sessions", `${sessionId}.json`);
  }

  private loadSession(sessionId: string | null): StoredSession {
    return this.loadSessionFile(this.resolveSessionFile(sessionId), {
      missingAsEmpty: true,
      backupCorrupted: true,
      explicitImport: false,
    });
  }

  private ensureHistoryFileWithinSizeLimit(filePath: string): void {
    if (existsSync(filePath) && statSync(filePath).size > MAX_IMPORT_BYTES) {
      throw new Error("History session file exceeds maximum size of 10 MiB");
    }
  }

  private saveSession(sessionId: string | null, thoughts: ThoughtData[]): string {
    const session = normalizeSessionId(sessionId);
    const lastUpdated = new Date().toISOString();
    this.saveToFile(
      this.resolveSessionFile(session.sessionId),
      this.createSessionEnvelope(session, thoughts, undefined, lastUpdated),
    );
    return lastUpdated;
  }

  private getSessionMetadata(sessionId: string | null): SessionStatusMetadata {
    const session = normalizeSessionId(sessionId);
    try {
      const loaded = this.loadSessionFile(this.resolveSessionFile(session.sessionId), {
        missingAsEmpty: true,
        backupCorrupted: false,
        explicitImport: false,
      });
      return {
        sessionId: session.sessionId,
        label: session.sessionLabel,
        thoughtCount: loaded.thoughts.length,
        lastUpdated: loaded.lastUpdated,
        isDefault: session.sessionId === null,
        stateFingerprint: this.fingerprintFor(session, loaded.thoughts, loaded.lastUpdated),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        sessionId: session.sessionId,
        label: session.sessionLabel,
        thoughtCount: 0,
        lastUpdated: null,
        isDefault: session.sessionId === null,
        stateFingerprint: this.fingerprintFor(session, [], null),
        corrupt: true,
        error: message,
      };
    }
  }

  // =============================================================================
  // File parsing and serialization
  // =============================================================================

  private loadSessionFile(
    filePath: string,
    options: { missingAsEmpty: boolean; backupCorrupted: boolean; explicitImport: boolean },
  ): StoredSession {
    if (!existsSync(filePath)) {
      if (options.missingAsEmpty) {
        return { thoughts: [], lastUpdated: null, warnings: [] };
      }
      throw new Error(`File not found: ${this.redactPath(filePath).value}`);
    }

    this.ensureReadableFile(filePath, options.explicitImport);

    // Apply the size cap unconditionally so a planted oversize session file
    // cannot OOM the process on any read path (status enumeration, history,
    // addThought, constructor warmup), not just explicit imports.
    if (statSync(filePath).size > MAX_IMPORT_BYTES) {
      throw new Error(
        options.explicitImport
          ? "Import file exceeds maximum size of 10 MiB"
          : "Session file exceeds maximum size of 10 MiB",
      );
    }

    try {
      const content = readFileSync(filePath, "utf-8");
      const data = JSON.parse(content) as unknown;
      return this.parseSessionData(data, options.explicitImport);
    } catch (error) {
      if (options.backupCorrupted) {
        console.warn(`[pi-sequential-thinking] Error loading ${this.redactPath(filePath).value}: ${error}`);
        this.backupCorruptedFile(filePath);
        return { thoughts: [], lastUpdated: null, warnings: [] };
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid session file ${this.redactPath(filePath).value}: ${message}`);
    }
  }

  private parseSessionData(data: unknown, _explicitImport: boolean): StoredSession {
    if (Array.isArray(data)) {
      const normalized = this.normalizeThoughtRecords(data);
      return {
        thoughts: normalized.thoughts,
        lastUpdated: null,
        warnings: ["Imported legacy array session format.", ...normalized.warnings],
      };
    }

    if (!isRecord(data)) {
      throw new Error("Session file must be an object or legacy thought array");
    }

    if (!Array.isArray(data.thoughts)) {
      // Throw on both paths so loadSessionFile's catch handles the backup
      // (when backupCorrupted is true) instead of silently returning empty
      // and letting the next save overwrite a malformed-but-parseable file.
      throw new Error("Session file must contain a thoughts array");
    }

    const normalized = this.normalizeThoughtRecords(data.thoughts);
    return {
      thoughts: normalized.thoughts,
      lastUpdated: typeof data.lastUpdated === "string" ? data.lastUpdated : null,
      warnings: normalized.warnings,
      embeddedSessionId: this.parseEmbeddedSessionId(data.sessionId),
    };
  }

  private normalizeThoughtRecords(records: unknown[]): { thoughts: ThoughtData[]; warnings: string[] } {
    const thoughts: ThoughtData[] = [];
    const warnings: string[] = [];
    records.forEach((record, index) => {
      if (!isRecord(record)) {
        throw new Error(`thoughts[${index}] must be an object`);
      }
      const normalized = normalizeThoughtRecord(record);
      thoughts.push(normalized.thought);
      warnings.push(...normalized.warnings.map((warning) => `thoughts[${index}]: ${warning}`));
    });
    return { thoughts, warnings };
  }

  private parseEmbeddedSessionId(value: unknown): string | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    try {
      return normalizeSessionId(value).sessionId;
    } catch (error) {
      if (error instanceof ThoughtValidationError) {
        // An invalid embedded sessionId should not condemn an otherwise-valid
        // session file. Treat the embedded id as absent and let the caller
        // either fall back to the default or use an explicit target.
        return undefined;
      }
      throw error;
    }
  }

  private createSessionEnvelope(
    session: SessionInfo,
    thoughts: ThoughtData[],
    exportedAt?: string,
    lastUpdated = new Date().toISOString(),
  ): Record<string, unknown> {
    const data: Record<string, unknown> = {
      schemaVersion: SCHEMA_VERSION,
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      thoughts: thoughts.map((thought) => thoughtToDict(thought, true)),
      lastUpdated,
      metadata: {
        totalThoughts: thoughts.length,
        stages: this.getStageCounts(thoughts),
      },
    };
    if (exportedAt) {
      data.exportedAt = exportedAt;
    }
    return data;
  }

  private saveToFile(filePath: string, data: Record<string, unknown>): void {
    this.ensureDirectory(dirname(filePath));
    const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(16).slice(2)}`;
    writeFileSync(tempPath, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 0o600 });
    this.restrictFilePermissions(tempPath);
    try {
      renameSync(tempPath, filePath);
    } catch (error) {
      // Avoid leaving a writable temp file behind when the atomic rename fails
      // (ENOSPC, EACCES, cross-device). The temp file's content is unpublished
      // so unlinking is the safe cleanup.
      try {
        unlinkSync(tempPath);
      } catch {
        // best effort; surface the original error below
      }
      throw error;
    }
    this.restrictFilePermissions(filePath);
  }

  // =============================================================================
  // Diagnostics and receipts
  // =============================================================================

  private createOperationResult(
    session: SessionInfo,
    preCount: number,
    postCount: number,
    thoughts: ThoughtData[],
    savedAt: string,
    changed: boolean,
  ): SessionOperationResult {
    return {
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      preCount,
      postCount,
      changed,
      savedAt,
      stateFingerprint: this.fingerprintFor(session, thoughts, savedAt),
    };
  }

  private fingerprintFor(session: SessionInfo, thoughts: ThoughtData[], lastUpdated: string | null): string {
    const payload = {
      schemaVersion: SCHEMA_VERSION,
      sessionId: session.sessionId,
      thoughtCount: thoughts.length,
      thoughtIds: thoughts.map((thought) => thought.id),
      thoughtTimestamps: thoughts.map((thought) => thought.timestamp),
      lastUpdated,
    };
    return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  }

  // Content-only fingerprint used to compare two thought sets without regard
  // to when they were saved. Used to decide whether an operation produced an
  // actual change in stored content (vs. a timestamp-only rewrite).
  private contentFingerprintFor(session: SessionInfo, thoughts: ThoughtData[]): string {
    return this.fingerprintFor(session, thoughts, null);
  }

  private toHistoryThought(thought: ThoughtData, includeFullThoughts: boolean): HistoryThoughtItem {
    const item: HistoryThoughtItem = {
      id: thought.id,
      thoughtNumber: thought.thought_number,
      totalThoughts: thought.total_thoughts,
      nextThoughtNeeded: thought.next_thought_needed,
      stage: thought.stage,
      tags: thought.tags,
      axiomsUsed: thought.axioms_used,
      assumptionsChallenged: thought.assumptions_challenged,
      timestamp: thought.timestamp,
    };
    if (includeFullThoughts) {
      item.thought = thought.thought;
    } else {
      item.snippet = thought.thought.length > 120 ? `${thought.thought.slice(0, 117)}...` : thought.thought;
    }
    return item;
  }

  private getStageCounts(thoughts: ThoughtData[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const stage of Object.values(ThoughtStage)) {
      const count = thoughts.filter((thought) => thought.stage === stage).length;
      if (count > 0) {
        counts[stage] = count;
      }
    }
    return counts;
  }

  private listNamedSessionIds(): { ids: string[]; overflowed: boolean; error?: string } {
    const sessionsDir = join(this.storageDir, "sessions");
    if (!existsSync(sessionsDir)) {
      return { ids: [], overflowed: false };
    }

    const sessionIds: string[] = [];
    let overflowed = false;
    let dir: Dir;
    try {
      dir = opendirSync(sessionsDir);
    } catch (error) {
      // EACCES / EMFILE on the sessions directory must not crash status.
      // Surface the failure as a partial-enumeration reason.
      const message = error instanceof Error ? error.message : String(error);
      return { ids: [], overflowed: true, error: message };
    }
    try {
      for (let entry = dir.readSync(); entry !== null; entry = dir.readSync()) {
        if (entry.isFile() && entry.name.endsWith(".json")) {
          if (sessionIds.length >= STATUS_ENUMERATION_SESSION_THRESHOLD) {
            overflowed = true;
            break;
          }
          sessionIds.push(entry.name.slice(0, -".json".length));
        }
      }
    } finally {
      dir.closeSync();
    }

    return { ids: sessionIds.sort(), overflowed };
  }

  private listBackupFiles(): { files: string[]; complete: boolean; reason?: string } {
    const files: string[] = [];
    const dirs = [this.storageDir];
    const maxInspectedEntries = STATUS_ENUMERATION_SESSION_THRESHOLD * 10;
    let inspectedEntries = 0;
    let complete = true;
    let errorCount = 0;

    while (dirs.length > 0) {
      if (inspectedEntries >= maxInspectedEntries || files.length > STATUS_ENUMERATION_SESSION_THRESHOLD) {
        complete = false;
        break;
      }

      const dirPath = dirs.pop();
      if (!dirPath || !existsSync(dirPath)) {
        continue;
      }

      let dir: Dir;
      try {
        dir = opendirSync(dirPath);
      } catch {
        complete = false;
        errorCount += 1;
        continue;
      }

      try {
        for (let entry = dir.readSync(); entry !== null; entry = dir.readSync()) {
          inspectedEntries += 1;
          const fullPath = join(dirPath, entry.name);
          if (entry.isDirectory()) {
            dirs.push(fullPath);
          } else if (entry.isFile() && entry.name.includes(".bak.") && !entry.name.endsWith(".json")) {
            // Backup names are `<orig>.bak.<timestamp>` (no .json suffix). Excluding
            // .json files here prevents a session file like `foo.bak.json` from
            // showing up in both backupFiles and sessions.
            files.push(relative(this.storageDir, fullPath));
          }

          if (inspectedEntries >= maxInspectedEntries || files.length > STATUS_ENUMERATION_SESSION_THRESHOLD) {
            complete = false;
            break;
          }
        }
      } catch {
        complete = false;
        errorCount += 1;
      } finally {
        dir.closeSync();
      }
    }

    const reasons: string[] = [];
    if (files.length > STATUS_ENUMERATION_SESSION_THRESHOLD || inspectedEntries >= maxInspectedEntries) {
      reasons.push("Backup file enumeration exceeded status bounds; backupFiles is partial.");
    }
    if (errorCount > 0) {
      reasons.push("Backup file enumeration skipped unreadable directories; backupFiles is partial.");
    }

    return {
      files: files.slice(0, STATUS_ENUMERATION_SESSION_THRESHOLD).sort(),
      complete,
      reason: reasons.length > 0 ? reasons.join(" ") : undefined,
    };
  }

  private redactEffectiveConfig(config: EffectiveConfigStatus): EffectiveConfigStatus {
    return {
      ...config,
      storageDir: config.storageDir ? this.redactPath(resolve(config.storageDir)).value : undefined,
      sources: { ...config.sources },
    };
  }

  private redactPath(filePath: string): { value: string; disclosure: ThinkingStatus["pathDisclosure"] } {
    const resolvedHome = resolve(this.homeDir);
    const resolvedPath = resolve(filePath);
    if (resolvedPath === resolvedHome || resolvedPath.startsWith(`${resolvedHome}/`)) {
      const suffix = resolvedPath.slice(resolvedHome.length);
      return { value: suffix ? `~${suffix}` : "~", disclosure: "home_redacted" };
    }
    if (!isAbsolute(filePath)) {
      return { value: filePath, disclosure: "relative" };
    }
    return { value: `<absolute:${basename(filePath)}>`, disclosure: "absolute_diagnostic" };
  }

  // =============================================================================
  // Filesystem utilities
  // =============================================================================

  private resolveExternalPath(filePath: string): string {
    const trimmed = filePath.trim();
    return isAbsolute(trimmed) ? trimmed : resolve(process.cwd(), trimmed);
  }

  private ensureExternalWriteTarget(filePath: string): void {
    if (existsSync(filePath)) {
      const stats = lstatSync(filePath);
      if (stats.isDirectory()) {
        throw new Error(`Cannot export to directory: ${this.redactPath(filePath).value}`);
      }
      if (stats.isSymbolicLink()) {
        throw new Error(`Cannot export to symlink: ${this.redactPath(filePath).value}`);
      }
    }
  }

  private ensureReadableFile(filePath: string, explicitImport: boolean): void {
    const stats = lstatSync(filePath);
    if (stats.isDirectory()) {
      throw new Error(`Cannot import directory: ${this.redactPath(filePath).value}`);
    }
    if (explicitImport && stats.isSymbolicLink()) {
      throw new Error(`Cannot import symlink: ${this.redactPath(filePath).value}`);
    }
  }

  private ensureDirectory(dir: string): void {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.restrictDirectoryPermissions(dir);
  }

  private restrictDirectoryPermissions(dir: string): void {
    if (process.platform === "win32") return;
    try {
      chmodSync(dir, 0o700);
    } catch {
      // Best effort only; some filesystems ignore POSIX modes.
    }
  }

  private restrictFilePermissions(filePath: string): void {
    if (process.platform === "win32") return;
    try {
      chmodSync(filePath, 0o600);
    } catch {
      // Best effort only; some filesystems ignore POSIX modes.
    }
  }

  private isWritable(dir: string): boolean {
    try {
      accessSync(dir, fsConstants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  private backupCorruptedFile(filePath: string): void {
    if (!existsSync(filePath)) {
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${filePath}.bak.${timestamp}`;

    try {
      renameSync(filePath, backupPath);
      console.log(`[pi-sequential-thinking] Backed up corrupted file to ${this.redactPath(backupPath).value}`);
    } catch {
      console.warn(`[pi-sequential-thinking] Could not backup corrupted file ${this.redactPath(filePath).value}`);
    }
  }
}
