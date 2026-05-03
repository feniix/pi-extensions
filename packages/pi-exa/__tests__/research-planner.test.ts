/**
 * Stateful research-planner tests for pi-exa.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  getResearchStatus,
  getResearchSummary,
  recordResearchStep,
  resetResearchPlanner,
} from "../extensions/research-planner.js";

describe("research planner state", () => {
  beforeEach(() => {
    resetResearchPlanner();
  });

  it("records steps, progress, and topic mismatch warnings", () => {
    const first = recordResearchStep({
      topic: "computer vision jump analysis",
      stage: "framing",
      note: "Frame the research objective and baseline assumptions.",
      thought_number: 1,
      total_thoughts: 5,
      next_step_needed: true,
      nextAction: "web_search_exa",
      nextActionReason: "Cheap discovery should come before deep synthesis.",
    });

    expect(first.stepCount).toBe(1);
    expect(first.progress.percent).toBe(20);
    expect(first.recommendedNextAction?.action).toBe("web_search_exa");

    const second = recordResearchStep({
      topic: "enterprise AI market sizing",
      stage: "framing",
      note: "This is a different topic.",
      thought_number: 2,
      total_thoughts: 5,
      next_step_needed: true,
    });

    expect(second.warnings).toContain(
      'Topic mismatch: active topic is "computer vision jump analysis"; received "enterprise AI market sizing". Call exa_research_reset before starting a new topic. Step was not recorded.',
    );
    const status = getResearchStatus();
    expect(status.topic).toBe("computer vision jump analysis");
    expect(status.stepCount).toBe(1);
    expect(status.activeStage).toBe("framing");
  });

  it("advances generated IDs after explicit IDs", () => {
    recordResearchStep({
      topic: "id generation",
      stage: "framing",
      note: "Record explicit IDs.",
      thought_number: 1,
      total_thoughts: 2,
      next_step_needed: true,
      criteria: [{ id: "C1", label: "Explicit criterion" }],
      sources: [{ id: "S1", title: "Explicit source" }],
      gaps: [{ id: "G1", description: "Explicit gap" }],
    });
    recordResearchStep({
      topic: "id generation",
      stage: "criteria_discovery",
      note: "Record generated IDs.",
      thought_number: 2,
      total_thoughts: 2,
      next_step_needed: false,
      criteria: [{ label: "Generated criterion" }],
      sources: [{ title: "Generated source" }],
      gaps: [{ description: "Generated gap" }],
    });

    const status = getResearchStatus();
    expect(status.criteria.map((criterion) => criterion.id)).toEqual(["C1", "C2"]);
    expect(status.sources.map((source) => source.id)).toEqual(["S1", "S2"]);
    expect(status.openGaps.map((gap) => gap.id)).toEqual(["G1", "G2"]);
  });

  it("aggregates criteria and validates evidence references", () => {
    recordResearchStep({
      topic: "computer vision jump analysis",
      stage: "source_retrieval",
      note: "Fetched the validation paper and mapped it to criteria.",
      thought_number: 1,
      total_thoughts: 3,
      next_step_needed: true,
      sources: [
        {
          id: "S1",
          title: "Validation paper",
          url: "https://example.com/paper",
          sourceType: "paper",
          retrievalStatus: "fetched",
          retrievalEvidence: "tool:web_fetch_exa call-1",
        },
      ],
      criteria: [
        {
          id: "C1",
          label: "Force plate validation",
          category: "method",
          priority: "high",
          status: "supported",
          evidenceRefs: ["S1"],
        },
        {
          id: "C2",
          label: "Camera angle sensitivity",
          category: "metric",
          priority: "medium",
          status: "supported",
          evidenceRefs: ["S404"],
        },
      ],
    });

    const status = getResearchStatus();
    expect(status.criteria).toHaveLength(2);
    expect(status.criteriaCoverage.supported).toBe(1);
    expect(status.criteriaCoverage.unresolvedEvidence).toBe(1);
    expect(status.criteria[1].evidenceIssues).toContain("Unresolved evidence ref: S404");
  });

  it("updates existing records without exposing mutable state", () => {
    recordResearchStep({
      topic: "record updates",
      stage: "framing",
      note: "Initial records.",
      thought_number: 1,
      total_thoughts: 2,
      next_step_needed: true,
      criteria: [{ id: "C1", label: "Validation", evidenceRefs: ["tool:web_search_exa call-1"] }],
      sources: [{ id: "S1", title: "Source", usedFor: ["C1"] }],
      gaps: [{ id: "G1", description: "Gap", severity: "important" }],
    });
    recordResearchStep({
      topic: "record updates",
      stage: "coverage_analysis",
      note: "Update records.",
      thought_number: 2,
      total_thoughts: 2,
      next_step_needed: false,
      criteria: [{ id: "C1", label: "Validation", status: "supported", evidenceRefs: ["tool:web_fetch_exa call-2"] }],
      sources: [
        { id: "S1", title: "Source", retrievalStatus: "fetched", retrievalEvidence: "tool:web_fetch_exa call-2" },
      ],
      gaps: [{ id: "G1", description: "Gap", severity: "minor" }],
    });

    const status = getResearchStatus();
    expect(status.criteria).toHaveLength(1);
    expect(status.sources).toHaveLength(1);
    expect(status.openGaps).toHaveLength(1);
    expect(status.criteria[0].evidenceRefs).toEqual(["tool:web_search_exa call-1", "tool:web_fetch_exa call-2"]);
    expect(status.sources[0].retrievalStatus).toBe("fetched");
    expect(status.openGaps[0].severity).toBe("minor");

    status.criteria[0].evidenceRefs.push("mutated");
    expect(getResearchStatus().criteria[0].evidenceRefs).not.toContain("mutated");
  });

  it("labels unverified sources as not directly inspected in source packs", () => {
    recordResearchStep({
      topic: "paper retrieval policy",
      stage: "cheap_discovery",
      note: "Discovered candidate source snippets.",
      thought_number: 1,
      total_thoughts: 2,
      next_step_needed: true,
      sources: [
        {
          id: "S1",
          title: "Snippet-only paper",
          url: "https://example.com/snippet",
          sourceType: "paper",
          retrievalStatus: "discovered_only",
          contentNotes: "Claims a strong correlation.",
        },
        {
          id: "S2",
          title: "Fetched paper",
          url: "https://example.com/fetched",
          sourceType: "paper",
          retrievalStatus: "fetched",
          retrievalEvidence: "tool:web_fetch_exa call-2",
          contentNotes: "Directly inspected methods section.",
        },
        {
          id: "S3",
          title: "Unverified fetched paper",
          sourceType: "paper",
          retrievalStatus: "fetched",
        },
      ],
    });

    const sourcePack = getResearchSummary({ mode: "source_pack" });
    expect(sourcePack).toContain("Snippet-only paper");
    expect(sourcePack).toContain("not directly inspected");
    expect(sourcePack).toContain("Fetched paper");
    expect(sourcePack).toContain("Unverified fetched paper");
    expect(sourcePack).toContain("Fetched source is missing retrieval evidence");
    const status = getResearchStatus();
    expect(status.sourcePackSummary.fetched).toBe(1);
    expect(status.sourcePackSummary.notDirectlyInspected).toBe(2);
  });

  it("warns without recording invalid branch, revision, and sequence references", () => {
    const invalidFirst = recordResearchStep({
      topic: "invalid first",
      stage: "framing",
      note: "Invalid first step.",
      thought_number: 1,
      total_thoughts: 3,
      next_step_needed: true,
      is_revision: true,
      revises_step: 99,
    });

    expect(invalidFirst.warnings).toContain("Revision references unknown step 99.");
    expect(getResearchStatus().topic).toBeUndefined();
    expect(getResearchStatus().stepCount).toBe(0);

    recordResearchStep({
      topic: "invalid references",
      stage: "framing",
      note: "Initial step.",
      thought_number: 1,
      total_thoughts: 3,
      next_step_needed: true,
    });

    const result = recordResearchStep({
      topic: "invalid references",
      stage: "criteria_discovery",
      note: "Invalid duplicate and references.",
      thought_number: 1,
      total_thoughts: 3,
      next_step_needed: true,
      is_revision: true,
      revises_step: 99,
      branch_from_step: 99,
      branch_id: "bad-branch",
    });

    expect(result.warnings).toContain("Duplicate thought_number 1; step was not recorded.");
    expect(result.warnings).toContain("Revision references unknown step 99.");
    expect(result.warnings).toContain("Branch references unknown step 99.");
    expect(getResearchStatus().stepCount).toBe(1);

    const uniqueInvalid = recordResearchStep({
      topic: "invalid references",
      stage: "criteria_discovery",
      note: "Invalid references with a unique thought number.",
      thought_number: 2,
      total_thoughts: 3,
      next_step_needed: true,
      is_revision: true,
      revises_step: 99,
      branch_from_step: 99,
      branch_id: "still-bad",
    });

    expect(uniqueInvalid.warnings).toContain("Revision references unknown step 99.");
    expect(uniqueInvalid.warnings).toContain("Branch references unknown step 99.");
    expect(getResearchStatus().stepCount).toBe(1);
    expect(getResearchStatus().branches).not.toContain("still-bad");
  });

  it("tracks gaps, branches, and revisions", () => {
    recordResearchStep({
      topic: "strategy comparison",
      stage: "framing",
      note: "Initial strategy.",
      thought_number: 1,
      total_thoughts: 3,
      next_step_needed: true,
    });
    recordResearchStep({
      topic: "strategy comparison",
      stage: "criteria_discovery",
      note: "Criteria pass.",
      thought_number: 2,
      total_thoughts: 3,
      next_step_needed: true,
      gaps: [{ id: "G1", description: "Need geography", severity: "blocking", resolution: "ask_user" }],
    });
    recordResearchStep({
      topic: "strategy comparison",
      stage: "coverage_analysis",
      note: "Paper-first branch.",
      thought_number: 3,
      total_thoughts: 3,
      next_step_needed: false,
      is_revision: true,
      revises_step: 1,
      branch_from_step: 2,
      branch_id: "paper-first",
    });

    const status = getResearchStatus();
    expect(status.branches).toContain("paper-first");
    expect(status.clarificationWarranted).toBe(true);
    expect(status.openGaps[0].description).toBe("Need geography");
    expect(status.revisions).toEqual([{ step: 3, revisesStep: 1 }]);
  });

  it("does not expose stored step objects through record results", () => {
    const result = recordResearchStep({
      topic: "step immutability",
      stage: "framing",
      note: "Initial step.",
      thought_number: 1,
      total_thoughts: 2,
      next_step_needed: true,
      nextAction: "web_search_exa",
    });

    result.step.thought_number = 99;
    result.step.nextAction = "finalize";
    result.step.warnings.push("mutated");

    const status = getResearchStatus();
    expect(status.progress.current).toBe(1);
    expect(status.recommendedNextAction?.action).toBe("web_search_exa");
    expect(status.warnings).not.toContain("mutated");
  });

  it("generates human-readable execution plans and labeled payloads without executing retrieval", () => {
    recordResearchStep({
      topic: "computer vision jump analysis",
      stage: "deep_research_plan",
      note: "Plan should compare pose-estimation methods against validation targets.",
      thought_number: 1,
      total_thoughts: 1,
      next_step_needed: false,
      assumptions: ["Focus on peer-reviewed validation before vendor claims."],
      criteria: [
        {
          id: "C1",
          label: "Validation metrics",
          category: "metric",
          priority: "high",
          status: "proposed",
        },
      ],
      nextAction: "web_research_exa",
      nextActionReason: "The plan is ready for explicit deep synthesis.",
    });

    const executionPlan = getResearchSummary({ mode: "execution_plan" });
    expect(executionPlan.startsWith("# Research Execution Plan")).toBe(true);
    expect(executionPlan).toContain("computer vision jump analysis");
    expect(executionPlan).not.toContain('"query"');

    const payload = getResearchSummary({ mode: "payload" });
    expect(payload).toContain("# Research Execution Plan");
    expect(payload).toContain("## Implementation payload");
    expect(payload).toContain('"query"');
    expect(payload).toContain("This payload is a suggestion only; no Exa retrieval call was executed.");
  });

  it("resets all planner state", () => {
    recordResearchStep({
      topic: "reset me",
      stage: "framing",
      note: "Temporary state.",
      thought_number: 1,
      total_thoughts: 1,
      next_step_needed: false,
    });

    resetResearchPlanner();

    const status = getResearchStatus();
    expect(status.stepCount).toBe(0);
    expect(status.topic).toBeUndefined();
  });
});
