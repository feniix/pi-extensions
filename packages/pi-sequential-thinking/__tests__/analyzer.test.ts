import { describe, expect, it } from "vitest";
import { ThoughtAnalyzer } from "../extensions/analyzer.js";
import { ThoughtStage } from "../extensions/types.js";

describe("ThoughtAnalyzer", () => {
  const analyzer = new ThoughtAnalyzer();

  // Helper to create thought data
  const createThought = (
    overrides: Partial<{
      id: string;
      thought_number: number;
      stage: ThoughtStage;
      tags: string[];
      total_thoughts: number;
    }> = {},
  ) => ({
    thought: "Test thought",
    thought_number: 1,
    total_thoughts: 5,
    next_thought_needed: true,
    stage: ThoughtStage.ANALYSIS,
    tags: [],
    axioms_used: [],
    assumptions_challenged: [],
    timestamp: "2024-01-01T00:00:00.000Z",
    id: "default-id",
    ...overrides,
  });

  describe("findRelatedThoughts", () => {
    it("finds thoughts in the same stage", () => {
      const current = createThought({ id: "current", stage: ThoughtStage.ANALYSIS });
      const related1 = createThought({ id: "related1", stage: ThoughtStage.ANALYSIS });
      const related2 = createThought({ id: "related2", stage: ThoughtStage.ANALYSIS });
      const other = createThought({ id: "other", stage: ThoughtStage.RESEARCH });

      const allThoughts = [current, related1, related2, other];
      const result = analyzer.findRelatedThoughts(current, allThoughts);

      expect(result.map((t) => t.id)).toContain("related1");
      expect(result.map((t) => t.id)).toContain("related2");
      expect(result.map((t) => t.id)).not.toContain("other");
    });

    it("prioritizes same stage over tag matches", () => {
      const current = createThought({
        id: "current",
        stage: ThoughtStage.RESEARCH,
        tags: ["tag1"],
      });
      const sameStage = createThought({ id: "same-stage", stage: ThoughtStage.RESEARCH });
      const tagMatch = createThought({
        id: "tag-match",
        stage: ThoughtStage.ANALYSIS,
        tags: ["tag1"],
      });

      const allThoughts = [current, sameStage, tagMatch];
      const result = analyzer.findRelatedThoughts(current, allThoughts, 1);

      expect(result[0].id).toBe("same-stage");
    });

    it("respects maxResults limit", () => {
      const current = createThought({ id: "current", stage: ThoughtStage.ANALYSIS });
      const related = [
        createThought({ id: "r1", stage: ThoughtStage.ANALYSIS }),
        createThought({ id: "r2", stage: ThoughtStage.ANALYSIS }),
        createThought({ id: "r3", stage: ThoughtStage.ANALYSIS }),
      ];

      const result = analyzer.findRelatedThoughts(current, [current, ...related], 2);
      expect(result.length).toBe(2);
    });

    it("finds tag-based related thoughts", () => {
      const current = createThought({
        id: "current",
        stage: ThoughtStage.RESEARCH, // Different stage so tag matching is primary
        tags: ["database", "performance"],
      });
      const match1 = createThought({ id: "match1", stage: ThoughtStage.ANALYSIS, tags: ["database"] });
      const match2 = createThought({ id: "match2", stage: ThoughtStage.SYNTHESIS, tags: ["database", "performance"] });

      const result = analyzer.findRelatedThoughts(current, [current, match1, match2], 2);

      // Should prefer match2 (more matching tags)
      expect(result[0].id).toBe("match2");
      expect(result[1].id).toBe("match1");
    });
  });

  describe("analyzeThought", () => {
    it("analyzes a thought with context", () => {
      const thought = createThought({
        id: "thought1",
        thought_number: 2,
        total_thoughts: 5,
        stage: ThoughtStage.SYNTHESIS,
        tags: ["architecture"],
      });
      const allThoughts = [createThought({ id: "prev", thought_number: 1, stage: ThoughtStage.SYNTHESIS }), thought];

      const result = analyzer.analyzeThought(thought, allThoughts);

      expect(result.thoughtAnalysis.currentThought.thoughtNumber).toBe(2);
      expect(result.thoughtAnalysis.currentThought.totalThoughts).toBe(5);
      expect(result.thoughtAnalysis.currentThought.stage).toBe(ThoughtStage.SYNTHESIS);
      expect(result.thoughtAnalysis.analysis.progress).toBe(40); // 2/5 * 100
      expect(result.thoughtAnalysis.analysis.isFirstInStage).toBe(false);
    });

    it("detects first thought in stage", () => {
      const thought = createThought({
        id: "first",
        thought_number: 1,
        stage: ThoughtStage.CONCLUSION,
      });
      const allThoughts = [thought];

      const result = analyzer.analyzeThought(thought, allThoughts);

      expect(result.thoughtAnalysis.analysis.isFirstInStage).toBe(true);
    });
  });

  describe("generateSummary", () => {
    it("returns message for empty thoughts", () => {
      const result = analyzer.generateSummary([]);
      expect(result.summary).toBe("No thoughts recorded yet");
    });

    it("generates summary with stage counts", () => {
      const thoughts = [
        createThought({ id: "1", thought_number: 1, stage: ThoughtStage.PROBLEM_DEFINITION }),
        createThought({ id: "2", thought_number: 2, stage: ThoughtStage.RESEARCH }),
        createThought({ id: "3", thought_number: 3, stage: ThoughtStage.RESEARCH }),
        createThought({ id: "4", thought_number: 4, stage: ThoughtStage.ANALYSIS }),
        createThought({ id: "5", thought_number: 5, stage: ThoughtStage.SYNTHESIS }),
        createThought({ id: "6", thought_number: 6, stage: ThoughtStage.CONCLUSION, total_thoughts: 6 }),
      ];

      const result = analyzer.generateSummary(thoughts);
      const summary = result.summary as { totalThoughts: number; stages: Record<string, number> };

      expect(summary.totalThoughts).toBe(6);
      expect(summary.stages["Problem Definition"]).toBe(1);
      expect(summary.stages.Research).toBe(2);
      expect(summary.stages.Analysis).toBe(1);
      expect(summary.stages.Synthesis).toBe(1);
      expect(summary.stages.Conclusion).toBe(1);
    });

    it("generates timeline", () => {
      const thoughts = [
        createThought({ id: "3", thought_number: 3 }),
        createThought({ id: "1", thought_number: 1 }),
        createThought({ id: "2", thought_number: 2 }),
      ];

      const result = analyzer.generateSummary(thoughts);
      const summary = result.summary as { timeline: Array<{ number: number; stage: string }> };

      expect(summary.timeline).toEqual([
        { number: 1, stage: ThoughtStage.ANALYSIS },
        { number: 2, stage: ThoughtStage.ANALYSIS },
        { number: 3, stage: ThoughtStage.ANALYSIS },
      ]);
    });

    it("counts top tags", () => {
      const thoughts = [
        createThought({ id: "1", tags: ["tag1", "tag2"] }),
        createThought({ id: "2", tags: ["tag1", "tag3"] }),
        createThought({ id: "3", tags: ["tag1"] }),
        createThought({ id: "4", tags: ["tag2"] }),
      ];

      const result = analyzer.generateSummary(thoughts);
      const summary = result.summary as { topTags: Array<{ tag: string; count: number }> };

      expect(summary.topTags[0]).toEqual({ tag: "tag1", count: 3 });
      expect(summary.topTags[1]).toEqual({ tag: "tag2", count: 2 });
      expect(summary.topTags[2]).toEqual({ tag: "tag3", count: 1 });
    });

    it("calculates completion percentage", () => {
      const thoughts = [
        createThought({ id: "1", thought_number: 1, total_thoughts: 10 }),
        createThought({ id: "2", thought_number: 2, total_thoughts: 10 }),
        createThought({ id: "3", thought_number: 3, total_thoughts: 10 }),
      ];

      const result = analyzer.generateSummary(thoughts);
      const summary = result.summary as { completionStatus: { percentComplete: number } };

      expect(summary.completionStatus.percentComplete).toBe(30);
    });

    it("detects all stages present", () => {
      const thoughts = Object.values(ThoughtStage).map((stage, i) =>
        createThought({ id: String(i), thought_number: i + 1, stage }),
      );

      const result = analyzer.generateSummary(thoughts);
      const summary = result.summary as { completionStatus: { hasAllStages: boolean } };

      expect(summary.completionStatus.hasAllStages).toBe(true);
    });
  });
});
