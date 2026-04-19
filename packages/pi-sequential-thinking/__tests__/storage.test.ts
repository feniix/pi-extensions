import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThoughtStorage } from "../extensions/index.js";
import type { ThoughtData } from "../extensions/types.js";
import { ThoughtStage } from "../extensions/types.js";

const createThought = (overrides: Partial<ThoughtData> = {}): ThoughtData => ({
  id: "test-id-1",
  thought: "Test thought content",
  thought_number: 1,
  total_thoughts: 3,
  next_thought_needed: true,
  stage: ThoughtStage.ANALYSIS,
  timestamp: new Date().toISOString(),
  tags: [],
  axioms_used: [],
  assumptions_challenged: [],
  ...overrides,
});

describe("ThoughtStorage", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `pi-storage-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("constructor", () => {
    it("creates storage with custom directory", () => {
      const _storage = new ThoughtStorage(tempDir);
      expect(existsSync(tempDir)).toBe(true);
    });

    it("creates default directory when none specified", () => {
      const storage = new ThoughtStorage();
      // Should not throw and should create directory
      expect(storage).toBeDefined();
    });
  });

  describe("addThought", () => {
    it("adds a thought to storage", () => {
      const storage = new ThoughtStorage(tempDir);
      const thought = createThought();

      storage.addThought(thought);

      const thoughts = storage.getAllThoughts();
      expect(thoughts).toHaveLength(1);
      expect(thoughts[0].thought).toBe("Test thought content");
    });

    it("persists thought to disk", () => {
      const storage = new ThoughtStorage(tempDir);
      storage.addThought(createThought());

      // Create new instance to verify persistence
      const storage2 = new ThoughtStorage(tempDir);
      const thoughts = storage2.getAllThoughts();

      expect(thoughts).toHaveLength(1);
    });

    it("adds multiple thoughts", () => {
      const storage = new ThoughtStorage(tempDir);
      storage.addThought(createThought({ thought_number: 1 }));
      storage.addThought(createThought({ thought_number: 2 }));
      storage.addThought(createThought({ thought_number: 3 }));

      const thoughts = storage.getAllThoughts();
      expect(thoughts).toHaveLength(3);
    });
  });

  describe("getAllThoughts", () => {
    it("returns empty array when no thoughts", () => {
      const storage = new ThoughtStorage(tempDir);
      expect(storage.getAllThoughts()).toEqual([]);
    });

    it("returns copy of thoughts array", () => {
      const storage = new ThoughtStorage(tempDir);
      storage.addThought(createThought());

      const thoughts1 = storage.getAllThoughts();
      const thoughts2 = storage.getAllThoughts();

      expect(thoughts1).not.toBe(thoughts2);
      expect(thoughts1).toEqual(thoughts2);
    });

    it("modifying returned array does not affect storage", () => {
      const storage = new ThoughtStorage(tempDir);
      storage.addThought(createThought());

      const thoughts = storage.getAllThoughts();
      thoughts.push(createThought({ id: "modified" }));

      expect(storage.getAllThoughts()).toHaveLength(1);
    });
  });

  describe("clearHistory", () => {
    it("clears all thoughts", () => {
      const storage = new ThoughtStorage(tempDir);
      storage.addThought(createThought());
      storage.addThought(createThought());

      storage.clearHistory();

      expect(storage.getAllThoughts()).toEqual([]);
    });

    it("persists cleared state", () => {
      const storage = new ThoughtStorage(tempDir);
      storage.addThought(createThought());
      storage.clearHistory();

      const storage2 = new ThoughtStorage(tempDir);
      expect(storage2.getAllThoughts()).toEqual([]);
    });
  });

  describe("exportSession", () => {
    it("exports thoughts to file", () => {
      const storage = new ThoughtStorage(tempDir);
      storage.addThought(createThought({ thought: "First thought" }));
      storage.addThought(createThought({ thought: "Second thought", thought_number: 2 }));

      const exportPath = join(tempDir, "export.json");
      storage.exportSession(exportPath);

      expect(existsSync(exportPath)).toBe(true);

      const exported = JSON.parse(readFileSync(exportPath, "utf-8"));
      expect(exported.thoughts).toHaveLength(2);
      expect(exported.metadata.totalThoughts).toBe(2);
      expect(exported.metadata.stages).toBeDefined();
    });

    it("includes export timestamp", () => {
      const storage = new ThoughtStorage(tempDir);
      storage.addThought(createThought());

      const exportPath = join(tempDir, "export2.json");
      storage.exportSession(exportPath);

      const exported = JSON.parse(readFileSync(exportPath, "utf-8"));
      expect(exported.exportedAt).toBeDefined();
    });
  });

  describe("importSession", () => {
    it("imports thoughts from file", () => {
      // First, create an export file manually
      const exportPath = join(tempDir, "import.json");
      const exportData = {
        thoughts: [
          {
            id: "imported-1",
            thought: "Imported thought 1",
            thought_number: 1,
            total_thoughts: 2,
            next_thought_needed: true,
            stage: "Analysis",
            timestamp: new Date().toISOString(),
            tags: [],
            axioms_used: [],
            assumptions_challenged: [],
          },
          {
            id: "imported-2",
            thought: "Imported thought 2",
            thought_number: 2,
            total_thoughts: 2,
            next_thought_needed: false,
            stage: "Conclusion",
            timestamp: new Date().toISOString(),
            tags: [],
            axioms_used: [],
            assumptions_challenged: [],
          },
        ],
        lastUpdated: new Date().toISOString(),
      };
      writeFileSync(exportPath, JSON.stringify(exportData), "utf-8");

      // Import into new storage
      const storage = new ThoughtStorage(tempDir);
      storage.importSession(exportPath);

      const thoughts = storage.getAllThoughts();
      expect(thoughts).toHaveLength(2);
      expect(thoughts[0].thought).toBe("Imported thought 1");
      expect(thoughts[1].thought).toBe("Imported thought 2");
    });

    it("handles legacy format (array directly)", () => {
      const legacyPath = join(tempDir, "legacy.json");
      const legacyData = [
        {
          id: "legacy-1",
          thought: "Legacy thought",
          thought_number: 1,
          total_thoughts: 1,
          next_thought_needed: false,
          stage: "Conclusion",
          timestamp: new Date().toISOString(),
          tags: [],
          axioms_used: [],
          assumptions_challenged: [],
        },
      ];
      writeFileSync(legacyPath, JSON.stringify(legacyData), "utf-8");

      const storage = new ThoughtStorage(tempDir);
      storage.importSession(legacyPath);

      const thoughts = storage.getAllThoughts();
      expect(thoughts).toHaveLength(1);
      expect(thoughts[0].thought).toBe("Legacy thought");
    });

    it("handles empty/invalid file", () => {
      const emptyPath = join(tempDir, "empty.json");
      writeFileSync(emptyPath, JSON.stringify({}), "utf-8");

      const storage = new ThoughtStorage(tempDir);
      storage.importSession(emptyPath);

      expect(storage.getAllThoughts()).toEqual([]);
    });

    it("handles non-existent file", () => {
      const storage = new ThoughtStorage(tempDir);
      storage.importSession(join(tempDir, "nonexistent.json"));

      expect(storage.getAllThoughts()).toEqual([]);
    });
  });

  describe("error handling", () => {
    it("handles corrupted JSON file gracefully", () => {
      const corruptedPath = join(tempDir, "corrupted.json");
      writeFileSync(corruptedPath, "not valid json {{{", "utf-8");

      // Should not throw
      const storage = new ThoughtStorage(tempDir);
      expect(storage.getAllThoughts()).toEqual([]);
    });

    it("handles invalid current_session.json", () => {
      // Create a storage with the session file
      const sessionFile = join(tempDir, "current_session.json");
      writeFileSync(sessionFile, "not valid json {{{{json", "utf-8");

      // Create storage - should handle corrupted session gracefully
      const storage = new ThoughtStorage(tempDir);

      // Should load empty and overwrite with valid data
      expect(storage.getAllThoughts()).toEqual([]);

      // Save should work
      storage.addThought(createThought());
      expect(storage.getAllThoughts()).toHaveLength(1);
    });
  });
});
