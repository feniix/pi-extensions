import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThoughtStorage } from "../extensions/index.js";
import type { ThoughtData } from "../extensions/types.js";
import {
  MAX_IMPORT_BYTES,
  SCHEMA_VERSION,
  STATUS_ENUMERATION_SESSION_THRESHOLD,
  ThoughtStage,
} from "../extensions/types.js";

const createThought = (overrides: Partial<ThoughtData> = {}): ThoughtData => ({
  id: "test-id-1",
  thought: "Test thought content",
  thought_number: 1,
  total_thoughts: 3,
  next_thought_needed: true,
  stage: ThoughtStage.ANALYSIS,
  timestamp: "2026-05-16T00:00:00.000Z",
  tags: [],
  axioms_used: [],
  assumptions_challenged: [],
  ...overrides,
});

describe("ThoughtStorage", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pi-storage-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("creates storage with custom directory", () => {
      const _storage = new ThoughtStorage(tempDir);
      expect(existsSync(tempDir)).toBe(true);
    });

    it("creates default directory when none specified", () => {
      const storage = new ThoughtStorage();
      expect(storage).toBeDefined();
    });

    it("uses restrictive directory permissions where supported", () => {
      const storageDir = join(tempDir, "restricted");
      new ThoughtStorage(storageDir);

      if (process.platform !== "win32") {
        expect(statSync(storageDir).mode & 0o077).toBe(0);
      }
    });
  });

  describe("default and named sessions", () => {
    it("adds thoughts to the default session", () => {
      const storage = new ThoughtStorage(tempDir);
      storage.addThought(createThought());

      const thoughts = storage.getAllThoughts();
      expect(thoughts).toHaveLength(1);
      expect(thoughts[0].thought).toBe("Test thought content");
      expect(existsSync(join(tempDir, "current_session.json"))).toBe(true);
    });

    it("isolates named sessions from the default session", () => {
      const storage = new ThoughtStorage(tempDir);
      storage.addThought(createThought({ thought: "Default" }));
      storage.addThought(createThought({ id: "named-id", thought: "Named" }), "architecture-review");

      expect(storage.getAllThoughts().map((t) => t.thought)).toEqual(["Default"]);
      expect(storage.getAllThoughts("architecture-review").map((t) => t.thought)).toEqual(["Named"]);
      expect(existsSync(join(tempDir, "sessions", "architecture-review.json"))).toBe(true);
    });

    it("persists named sessions across instances", () => {
      const storage = new ThoughtStorage(tempDir);
      storage.addThought(createThought({ thought: "Persisted" }), "named");

      const storage2 = new ThoughtStorage(tempDir);
      expect(storage2.getAllThoughts("named")).toHaveLength(1);
      expect(storage2.getAllThoughts("named")[0].thought).toBe("Persisted");
    });

    it("loads existing current_session.json without migration", () => {
      writeFileSync(
        join(tempDir, "current_session.json"),
        JSON.stringify({
          thoughts: [
            {
              id: "existing-id",
              thought: "Existing default",
              thoughtNumber: 1,
              totalThoughts: 1,
              nextThoughtNeeded: false,
              stage: "Conclusion",
              timestamp: "2026-05-16T00:00:00.000Z",
            },
          ],
          lastUpdated: "2026-05-16T00:00:00.000Z",
        }),
        "utf-8",
      );

      const storage = new ThoughtStorage(tempDir);
      expect(storage.getAllThoughts()).toHaveLength(1);
      expect(storage.getAllThoughts()[0].thought).toBe("Existing default");
    });

    it("rejects invalid named session ids", () => {
      const storage = new ThoughtStorage(tempDir);
      expect(() => storage.addThought(createThought(), "bad/session")).toThrow(/session_id/i);
      expect(() => storage.getAllThoughts("default")).toThrow(/reserved/i);
    });
  });

  describe("clearHistory", () => {
    it("clears only the selected session and returns receipt metadata", () => {
      const storage = new ThoughtStorage(tempDir);
      storage.addThought(createThought({ thought: "Default" }));
      storage.addThought(createThought({ id: "named-id", thought: "Named" }), "named");

      const result = storage.clearHistory("named");

      expect(result.preCount).toBe(1);
      expect(result.postCount).toBe(0);
      expect(result.changed).toBe(true);
      expect(storage.getAllThoughts()).toHaveLength(1);
      expect(storage.getAllThoughts("named")).toHaveLength(0);
    });
  });

  describe("history", () => {
    it("returns bounded history in insertion order with pagination", () => {
      const storage = new ThoughtStorage(tempDir);
      storage.addThought(createThought({ id: "one", thought: "First", thought_number: 1 }), "plan");
      storage.addThought(createThought({ id: "two", thought: "Second", thought_number: 2 }), "plan");
      storage.addThought(createThought({ id: "three", thought: "Third", thought_number: 3 }), "plan");

      const history = storage.getHistory({ sessionId: "plan", limit: 2, offset: 1, includeFullThoughts: true });

      expect(history.totalThoughts).toBe(3);
      expect(history.hasMore).toBe(false);
      expect(history.thoughts.map((t) => t.thoughtNumber)).toEqual([2, 3]);
      expect(history.thoughts.map((t) => t.thought)).toEqual(["Second", "Third"]);
    });

    it("returns snippets without full thought bodies when requested", () => {
      const storage = new ThoughtStorage(tempDir);
      const longThought = "x".repeat(180);
      storage.addThought(createThought({ thought: longThought }), "plan");

      const history = storage.getHistory({ sessionId: "plan", includeFullThoughts: false });
      expect(history.thoughts[0].snippet).toBeDefined();
      expect(history.thoughts[0].thought).toBeUndefined();
      expect(history.thoughts[0].snippet).not.toBe(longThought);
    });

    it("enforces history bounds", () => {
      const storage = new ThoughtStorage(tempDir);
      expect(() => storage.getHistory({ limit: 0 })).toThrow(/limit/i);
      expect(() => storage.getHistory({ limit: 101 })).toThrow(/limit/i);
      expect(() => storage.getHistory({ offset: -1 })).toThrow(/offset/i);
    });

    it("rejects oversized persisted history files before parsing", () => {
      const storage = new ThoughtStorage(tempDir);
      const sessionFile = join(tempDir, "current_session.json");
      writeFileSync(sessionFile, "{".repeat(MAX_IMPORT_BYTES + 1), "utf-8");

      expect(() => storage.getHistory()).toThrow(/10 MiB/i);
      expect(existsSync(sessionFile)).toBe(true);
      expect(storage.getStatus().backupFiles.some((file) => file.startsWith("current_session.json.bak."))).toBe(false);
    });
  });

  describe("exportSession", () => {
    it("exports the selected session with the new schema", () => {
      const storage = new ThoughtStorage(tempDir);
      storage.addThought(createThought({ thought: "Default" }));
      storage.addThought(createThought({ id: "named-id", thought: "Named" }), "research");

      const exportPath = join(tempDir, "export.json");
      const result = storage.exportSession(exportPath, "research");

      expect(result.preCount).toBe(1);
      expect(result.postCount).toBe(1);
      expect(result.overwroteExistingFile).toBe(false);
      const exported = JSON.parse(readFileSync(exportPath, "utf-8"));
      expect(exported.schemaVersion).toBe(SCHEMA_VERSION);
      expect(exported.sessionId).toBe("research");
      expect(exported.sessionLabel).toBe("research");
      expect(exported.thoughts).toHaveLength(1);
      expect(exported.thoughts[0].thought).toBe("Named");
      expect(exported.metadata.totalThoughts).toBe(1);
    });

    it("reports overwrite and rejects directories and final symlinks", () => {
      const storage = new ThoughtStorage(tempDir);
      storage.addThought(createThought());

      const exportPath = join(tempDir, "export.json");
      writeFileSync(exportPath, "{}", "utf-8");
      expect(storage.exportSession(exportPath).overwroteExistingFile).toBe(true);
      expect(() => storage.exportSession(tempDir)).toThrow(/directory/i);

      if (process.platform !== "win32") {
        const symlinkPath = join(tempDir, "export-link.json");
        const targetPath = join(tempDir, "target.json");
        writeFileSync(targetPath, "{}", "utf-8");
        try {
          symlinkSync(targetPath, symlinkPath);
        } catch {
          // ignore unsupported symlink creation
        }
        if (existsSync(symlinkPath) && lstatSync(symlinkPath).isSymbolicLink()) {
          expect(() => storage.exportSession(symlinkPath)).toThrow(/symlink/i);
        }
      }
    });
  });

  describe("importSession", () => {
    it("imports legacy arrays into a named session without touching default", () => {
      const storage = new ThoughtStorage(tempDir);
      storage.addThought(createThought({ thought: "Default" }));
      const legacyPath = join(tempDir, "legacy.json");
      writeFileSync(
        legacyPath,
        JSON.stringify([
          {
            id: "legacy-id",
            thought: "Legacy thought",
            thought_number: 4,
            total_thoughts: 6,
            next_thought_needed: true,
            stage: "Analysis",
            timestamp: "2026-05-16T00:00:00.000Z",
          },
        ]),
        "utf-8",
      );

      const result = storage.importSession(legacyPath, "legacy-import");

      expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining("legacy")]));
      expect(storage.getAllThoughts()).toHaveLength(1);
      const imported = storage.getAllThoughts("legacy-import");
      expect(imported).toHaveLength(1);
      expect(imported[0]).toMatchObject({
        thought_number: 4,
        total_thoughts: 6,
        next_thought_needed: true,
      });
    });

    it("imports legacy objects without session metadata into the default session", () => {
      const storage = new ThoughtStorage(tempDir);
      storage.addThought(createThought({ thought: "Replaced default" }));
      const legacyPath = join(tempDir, "legacy-object.json");
      writeFileSync(
        legacyPath,
        JSON.stringify({
          thoughts: [
            {
              id: "legacy-object-id",
              thought: "Legacy object thought",
              thoughtNumber: 2,
              totalThoughts: 3,
              nextThoughtNeeded: true,
              stage: "Research",
              timestamp: "2026-05-16T00:00:00.000Z",
            },
          ],
        }),
        "utf-8",
      );

      const result = storage.importSession(legacyPath);

      expect(result).toMatchObject({ sessionId: null, preCount: 1, postCount: 1, changed: true });
      expect(storage.getAllThoughts()).toEqual([
        expect.objectContaining({
          id: "legacy-object-id",
          thought: "Legacy object thought",
          thought_number: 2,
          total_thoughts: 3,
          next_thought_needed: true,
          stage: ThoughtStage.RESEARCH,
        }),
      ]);
    });

    it("uses embedded sessionId when no explicit target is provided", () => {
      const storage = new ThoughtStorage(tempDir);
      const importPath = join(tempDir, "research.json");
      writeFileSync(
        importPath,
        JSON.stringify({
          schemaVersion: 1,
          sessionId: "research",
          sessionLabel: "research",
          thoughts: [createThought({ thought: "Embedded" })],
        }),
        "utf-8",
      );

      storage.importSession(importPath);
      expect(storage.getAllThoughts("research")[0].thought).toBe("Embedded");
      expect(storage.getAllThoughts()).toEqual([]);
    });

    it("lets explicit target win over embedded sessionId and returns a warning", () => {
      const storage = new ThoughtStorage(tempDir);
      const importPath = join(tempDir, "research.json");
      writeFileSync(
        importPath,
        JSON.stringify({
          schemaVersion: 1,
          sessionId: "research",
          sessionLabel: "research",
          thoughts: [createThought({ thought: "Moved" })],
        }),
        "utf-8",
      );

      const result = storage.importSession(importPath, "review");
      expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining("sessionId")]));
      expect(storage.getAllThoughts("review")[0].thought).toBe("Moved");
      expect(storage.getAllThoughts("research")).toEqual([]);
    });

    it("rejects missing, malformed, directory, and oversized explicit imports", () => {
      const storage = new ThoughtStorage(tempDir);
      expect(() => storage.importSession(join(tempDir, "missing.json"))).toThrow(/File not found/i);

      const malformedPath = join(tempDir, "malformed.json");
      writeFileSync(malformedPath, JSON.stringify({}), "utf-8");
      expect(() => storage.importSession(malformedPath)).toThrow(/thoughts/i);

      expect(() => storage.importSession(tempDir)).toThrow(/directory/i);

      const oversizedPath = join(tempDir, "oversized.json");
      writeFileSync(oversizedPath, " ".repeat(MAX_IMPORT_BYTES + 1), "utf-8");
      expect(() => storage.importSession(oversizedPath)).toThrow(/10 MiB/i);
    });
  });

  describe("status", () => {
    it("reports content-free status with redacted paths and backup files", () => {
      const homeStorageDir = join(tempDir, "home", ".mcp_sequential_thinking");
      const storage = new ThoughtStorage(homeStorageDir, { homeDir: join(tempDir, "home") });
      storage.addThought(createThought({ thought: "Sensitive default", tags: ["secret"] }));
      storage.addThought(createThought({ id: "named-id", thought: "Sensitive named" }), "research");
      writeFileSync(join(homeStorageDir, "current_session.json.bak.test"), "{}", "utf-8");

      const status = storage.getStatus({
        effectiveConfig: {
          storageDir: homeStorageDir,
          maxBytes: 51200,
          maxLines: 2000,
          sources: { storageDir: "flag", maxBytes: "default", maxLines: "default" },
        },
      });

      const serialized = JSON.stringify(status);
      expect(status.storageDir).toContain("~");
      expect(status.pathDisclosure).toBe("home_redacted");
      expect(status.namedSessionCount).toBe(1);
      expect(status.totalThoughts).toBe(2);
      expect(status.sessions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sessionId: null, label: "default", thoughtCount: 1, isDefault: true }),
          expect.objectContaining({ sessionId: "research", label: "research", thoughtCount: 1, isDefault: false }),
        ]),
      );
      expect(status.backupFiles).toEqual(["current_session.json.bak.test"]);
      expect(status.effectiveConfig?.sources.storageDir).toBe("flag");
      expect(serialized).not.toContain("Sensitive");
      expect(serialized).not.toContain("secret");
      expect(serialized).not.toContain(homeStorageDir);
    });

    it("reports partial status after the named-session enumeration threshold", () => {
      const sessionsDir = join(tempDir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const storage = new ThoughtStorage(tempDir);
      for (let index = 0; index < STATUS_ENUMERATION_SESSION_THRESHOLD + 5; index++) {
        writeFileSync(join(sessionsDir, `session-${index}.json`), JSON.stringify({ thoughts: [] }), "utf-8");
      }

      const status = storage.getStatus();

      // namedSessionCount is capped at the enumeration threshold so the value
      // is interpretable; the partial-completion flag signals overflow.
      expect(status.namedSessionCount).toBe(STATUS_ENUMERATION_SESSION_THRESHOLD);
      expect(status.totalThoughts).toBeUndefined();
      expect(status.statusCompleteness).toMatchObject({
        complete: false,
        inspectedNamedSessions: STATUS_ENUMERATION_SESSION_THRESHOLD,
        namedSessionThreshold: STATUS_ENUMERATION_SESSION_THRESHOLD,
      });
      expect(status.sessions).toHaveLength(STATUS_ENUMERATION_SESSION_THRESHOLD + 1); // default + inspected named sessions
    });

    it("skips invalid named session files while reporting status", () => {
      const sessionsDir = join(tempDir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const storage = new ThoughtStorage(tempDir);
      storage.addThought(createThought({ id: "valid-id" }), "valid");
      writeFileSync(join(sessionsDir, "default.json"), "{}", "utf-8");

      const status = storage.getStatus();

      expect(status.sessions).toEqual(expect.arrayContaining([expect.objectContaining({ sessionId: "valid" })]));
      expect(status.sessions).not.toEqual(expect.arrayContaining([expect.objectContaining({ sessionId: "default" })]));
      expect(status.statusCompleteness.skippedInvalidNamedSessions).toBe(1);
    });

    it("reports corrupt named sessions without moving the file to a backup", () => {
      const sessionsDir = join(tempDir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const corruptSessionFile = join(sessionsDir, "corrupt.json");
      writeFileSync(corruptSessionFile, "not valid json {{{{json", "utf-8");
      const storage = new ThoughtStorage(tempDir);

      const status = storage.getStatus();

      expect(existsSync(corruptSessionFile)).toBe(true);
      expect(status.backupFiles.some((file) => file.includes("corrupt.json.bak."))).toBe(false);
      expect(status.sessions).toEqual(
        expect.arrayContaining([expect.objectContaining({ sessionId: "corrupt", thoughtCount: 0, corrupt: true })]),
      );
    });
  });

  describe("error handling", () => {
    it("backs up corrupted active session files and recovers empty", () => {
      const sessionFile = join(tempDir, "current_session.json");
      writeFileSync(sessionFile, "not valid json {{{{json", "utf-8");

      const storage = new ThoughtStorage(tempDir);

      expect(storage.getAllThoughts()).toEqual([]);
      expect(storage.getStatus().backupFiles.some((file) => file.startsWith("current_session.json.bak."))).toBe(true);
      storage.addThought(createThought());
      expect(storage.getAllThoughts()).toHaveLength(1);
    });

    it("backs up default session file that parses to an object missing the thoughts array", () => {
      const sessionFile = join(tempDir, "current_session.json");
      writeFileSync(sessionFile, JSON.stringify({ lastUpdated: "2026-05-16T00:00:00.000Z" }), "utf-8");

      const storage = new ThoughtStorage(tempDir);

      expect(storage.getAllThoughts()).toEqual([]);
      expect(storage.getStatus().backupFiles.some((file) => file.startsWith("current_session.json.bak."))).toBe(true);
    });

    it("does not back up a named session that has a valid thoughts array but an invalid embedded sessionId", () => {
      const sessionsDir = join(tempDir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const sessionFile = join(sessionsDir, "review.json");
      writeFileSync(
        sessionFile,
        JSON.stringify({
          schemaVersion: 1,
          sessionId: "default",
          thoughts: [createThought({ thought: "Still valid" })],
        }),
        "utf-8",
      );

      const storage = new ThoughtStorage(tempDir);
      expect(storage.getAllThoughts("review")[0].thought).toBe("Still valid");
      expect(storage.getStatus().backupFiles.some((file) => file.includes("review.json.bak."))).toBe(false);
    });
  });

  describe("reads do not materialize session directories", () => {
    it("does not create the sessions/ directory when calling getAllThoughts on the default session", () => {
      const storage = new ThoughtStorage(tempDir);
      storage.getAllThoughts();
      expect(existsSync(join(tempDir, "sessions"))).toBe(false);
    });

    it("does not create the sessions/ directory when reading history for the default session", () => {
      const storage = new ThoughtStorage(tempDir);
      storage.getHistory();
      expect(existsSync(join(tempDir, "sessions"))).toBe(false);
    });

    it("does not create the sessions/ directory when calling getStatus with no named sessions", () => {
      const storage = new ThoughtStorage(tempDir);
      storage.getStatus();
      expect(existsSync(join(tempDir, "sessions"))).toBe(false);
    });
  });

  describe("importSession overwrite reporting", () => {
    it("reports preCount and overwroteExistingThoughts when importing into a populated session", () => {
      const storage = new ThoughtStorage(tempDir);
      storage.addThought(createThought({ thought: "Existing" }), "target");

      const importPath = join(tempDir, "import.json");
      writeFileSync(
        importPath,
        JSON.stringify({ schemaVersion: 1, sessionId: "target", thoughts: [createThought({ thought: "Replaced" })] }),
        "utf-8",
      );

      const result = storage.importSession(importPath, "target");

      expect(result.preCount).toBe(1);
      expect(result.postCount).toBe(1);
      expect(result.overwroteExistingThoughts).toBe(true);
    });

    it("reports overwroteExistingThoughts false when target session was empty", () => {
      const storage = new ThoughtStorage(tempDir);

      const importPath = join(tempDir, "import.json");
      writeFileSync(
        importPath,
        JSON.stringify({ schemaVersion: 1, sessionId: "empty", thoughts: [createThought({ thought: "New" })] }),
        "utf-8",
      );

      const result = storage.importSession(importPath, "empty");
      expect(result.preCount).toBe(0);
      expect(result.overwroteExistingThoughts).toBe(false);
    });

    it("reports changed=false when imported content is identical to existing", () => {
      const storage = new ThoughtStorage(tempDir);
      const existing = createThought({ id: "fixed-id", thought: "Same", timestamp: "2026-05-16T00:00:00.000Z" });
      storage.addThought(existing, "stable");

      const importPath = join(tempDir, "identical.json");
      writeFileSync(
        importPath,
        JSON.stringify({ schemaVersion: 1, sessionId: "stable", thoughts: [existing] }),
        "utf-8",
      );

      const result = storage.importSession(importPath, "stable");
      expect(result.changed).toBe(false);
    });
  });

  describe("getStatus completeness with corrupt sessions", () => {
    it("flags totalThoughts undefined and complete=false when any session is corrupt", () => {
      const sessionsDir = join(tempDir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(join(sessionsDir, "broken.json"), "not valid json", "utf-8");
      const storage = new ThoughtStorage(tempDir);
      storage.addThought(createThought({ thought: "Default" }));

      const status = storage.getStatus();

      expect(status.statusCompleteness.complete).toBe(false);
      expect(status.statusCompleteness.reason).toMatch(/corrupt/i);
      expect(status.totalThoughts).toBeUndefined();
    });
  });

  describe("namedSessionCount accuracy", () => {
    it("caps reported namedSessionCount at the enumeration threshold so the value is not misleading", () => {
      const sessionsDir = join(tempDir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const storage = new ThoughtStorage(tempDir);
      for (let index = 0; index < STATUS_ENUMERATION_SESSION_THRESHOLD + 5; index++) {
        writeFileSync(join(sessionsDir, `session-${index}.json`), JSON.stringify({ thoughts: [] }), "utf-8");
      }

      const status = storage.getStatus();
      expect(status.namedSessionCount).toBeLessThanOrEqual(STATUS_ENUMERATION_SESSION_THRESHOLD);
      expect(status.statusCompleteness.complete).toBe(false);
    });
  });

  describe("non-explicit load size guard", () => {
    it("rejects oversized named session file when loading via getAllThoughts (non-explicit load)", () => {
      const sessionsDir = join(tempDir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(join(sessionsDir, "huge.json"), " ".repeat(MAX_IMPORT_BYTES + 1), "utf-8");
      const storage = new ThoughtStorage(tempDir);
      expect(() => storage.getAllThoughts("huge")).toThrow(/10 MiB/i);
    });
  });
});
