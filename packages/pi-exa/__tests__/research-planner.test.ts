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
import {
  CRITERION_CATEGORIES,
  CRITERION_STATUSES,
  GAP_RESOLUTIONS,
  GAP_SEVERITIES,
  RESEARCH_NEXT_ACTIONS,
  RESEARCH_STAGES,
  RETRIEVAL_STATUSES,
  SOURCE_TYPES,
  SUMMARY_MODES,
} from "../extensions/research-planner-types.js";
import { exaResearchStepParams, exaResearchSummaryParams } from "../extensions/schemas.js";

const literalValues = (schema: { anyOf?: Array<{ const: string }> }) => schema.anyOf?.map((entry) => entry.const) ?? [];

describe("research planner schemas", () => {
  it("keeps schema enum literals aligned with planner constants", () => {
    const stepProperties = exaResearchStepParams.properties;
    const criterionProperties = stepProperties.criteria.items.properties;
    const sourceProperties = stepProperties.sources.items.properties;
    const gapProperties = stepProperties.gaps.items.properties;

    expect(literalValues(stepProperties.stage)).toEqual([...RESEARCH_STAGES]);
    expect(literalValues(stepProperties.nextAction)).toEqual([...RESEARCH_NEXT_ACTIONS]);
    expect(literalValues(criterionProperties.category)).toEqual([...CRITERION_CATEGORIES]);
    expect(literalValues(criterionProperties.status)).toEqual([...CRITERION_STATUSES]);
    expect(literalValues(criterionProperties.priority)).toEqual(["high", "medium", "low"]);
    expect(literalValues(sourceProperties.sourceType)).toEqual([...SOURCE_TYPES]);
    expect(literalValues(sourceProperties.retrievalStatus)).toEqual([...RETRIEVAL_STATUSES]);
    expect(literalValues(gapProperties.severity)).toEqual([...GAP_SEVERITIES]);
    expect(literalValues(gapProperties.resolution)).toEqual([...GAP_RESOLUTIONS]);
    expect(literalValues(exaResearchSummaryParams.properties.mode)).toEqual([...SUMMARY_MODES]);
  });
});

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

  it("keeps same-title sources with different URLs separate", () => {
    recordResearchStep({
      topic: "source identity",
      stage: "cheap_discovery",
      note: "Record generic page titles from different URLs.",
      thought_number: 1,
      total_thoughts: 1,
      next_step_needed: false,
      sources: [
        { title: "Introduction", url: "https://example.com/a", retrievalStatus: "discovered_only" },
        { title: "Introduction", url: "https://example.com/b", retrievalStatus: "discovered_only" },
      ],
    });

    const status = getResearchStatus();
    expect(status.sources).toHaveLength(2);
    expect(status.sources.map((source) => source.url)).toEqual(["https://example.com/a", "https://example.com/b"]);
  });

  it("preserves stable source IDs when merging by URL", () => {
    recordResearchStep({
      topic: "source id stability",
      stage: "source_retrieval",
      note: "Record initial source and evidence.",
      thought_number: 1,
      total_thoughts: 2,
      next_step_needed: true,
      sources: [{ id: "S1", title: "Initial", url: "https://example.com/a", retrievalStatus: "fetched" }],
      criteria: [{ id: "C1", label: "Evidence", status: "supported", evidenceRefs: ["S1"] }],
    });

    recordResearchStep({
      topic: "source id stability",
      stage: "source_retrieval",
      note: "Record the same URL with a conflicting explicit ID.",
      thought_number: 2,
      total_thoughts: 2,
      next_step_needed: false,
      sources: [
        {
          id: "S2",
          title: "Updated",
          url: "https://example.com/a",
          retrievalStatus: "fetched",
          retrievalEvidence: "tool:web_fetch_exa call-2",
        },
      ],
    });

    const status = getResearchStatus();
    expect(status.sources).toHaveLength(1);
    expect(status.sources[0].id).toBe("S1");
    expect(status.sources[0].title).toBe("Updated");
    expect(status.criteria[0].evidenceIssues).toEqual([]);
    expect(status.criteriaCoverage.supported).toBe(1);
  });

  it("warns instead of rewriting conflicting stable IDs", () => {
    recordResearchStep({
      topic: "conflict handling",
      stage: "source_retrieval",
      note: "Record initial stable IDs.",
      thought_number: 1,
      total_thoughts: 2,
      next_step_needed: true,
      criteria: [
        { id: "C1", label: "Original criterion", status: "supported", evidenceRefs: ["tool:web_search_exa call-1"] },
      ],
      sources: [{ id: "S1", title: "Original source", url: "https://example.com/a" }],
      gaps: [{ id: "G1", description: "Original gap" }],
    });

    const result = recordResearchStep({
      topic: "conflict handling",
      stage: "coverage_analysis",
      note: "Try conflicting stable IDs.",
      thought_number: 2,
      total_thoughts: 2,
      next_step_needed: false,
      criteria: [{ id: "C1", label: "Different criterion" }],
      sources: [{ id: "S1", title: "Different source", url: "https://example.com/b" }],
      gaps: [{ id: "G1", description: "Different gap" }],
    });

    expect(result.warnings).toContain(
      'Criterion C1 already exists as "Original criterion"; conflicting label "Different criterion" was ignored.',
    );
    expect(result.warnings).toContain(
      "Source S1 already exists for https://example.com/a; conflicting URL https://example.com/b was ignored.",
    );
    expect(result.warnings).toContain(
      'Gap G1 already exists as "Original gap"; conflicting description "Different gap" was ignored.',
    );

    const status = getResearchStatus();
    expect(status.criteria[0].label).toBe("Original criterion");
    expect(status.sources[0].url).toBe("https://example.com/a");
    expect(status.openGaps[0].description).toBe("Original gap");
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

  it("does not count malformed tool evidence as supported coverage", () => {
    recordResearchStep({
      topic: "evidence validation",
      stage: "coverage_analysis",
      note: "Record malformed evidence refs.",
      thought_number: 1,
      total_thoughts: 1,
      next_step_needed: false,
      criteria: [
        { id: "C1", label: "Bare tool prefix", status: "supported", evidenceRefs: ["tool:"] },
        { id: "C2", label: "Unknown tool", status: "supported", evidenceRefs: ["tool:made-up call-1"] },
        { id: "C3", label: "No evidence", status: "supported" },
      ],
    });

    const status = getResearchStatus();
    expect(status.criteriaCoverage.supported).toBe(0);
    expect(status.criteriaCoverage.unresolvedEvidence).toBe(3);
    expect(status.criteria[0].evidenceIssues).toContain("Unresolved evidence ref: tool:");
    expect(status.criteria[1].evidenceIssues).toContain("Unresolved evidence ref: tool:made-up call-1");
    expect(status.criteria[2].evidenceIssues).toContain("Supported criterion has no evidence refs.");
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

    expect(uniqueInvalid.warnings).toContain("Revision steps cannot also define branch metadata.");
    expect(uniqueInvalid.warnings).toContain("Revision references unknown step 99.");
    expect(uniqueInvalid.warnings).toContain("Branch references unknown step 99.");
    expect(getResearchStatus().stepCount).toBe(1);
    expect(getResearchStatus().branches).not.toContain("still-bad");

    const missingBranchId = recordResearchStep({
      topic: "invalid references",
      stage: "criteria_discovery",
      note: "Missing branch ID.",
      thought_number: 2,
      total_thoughts: 3,
      next_step_needed: true,
      branch_from_step: 1,
    });
    expect(missingBranchId.warnings).toContain("branch_from_step requires branch_id.");
    expect(getResearchStatus().stepCount).toBe(1);

    const outOfOrder = recordResearchStep({
      topic: "invalid references",
      stage: "criteria_discovery",
      note: "Step three.",
      thought_number: 3,
      total_thoughts: 3,
      next_step_needed: true,
    });
    expect(outOfOrder.stepCount).toBe(2);

    const regressed = recordResearchStep({
      topic: "invalid references",
      stage: "criteria_discovery",
      note: "Regressed thought number.",
      thought_number: 2,
      total_thoughts: 3,
      next_step_needed: true,
    });
    expect(regressed.warnings).toContain(
      "Out-of-order thought_number 2; last recorded thought_number is 3. Step was not recorded.",
    );
    expect(getResearchStatus().stepCount).toBe(2);
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
      note: "Revision to initial framing.",
      thought_number: 3,
      total_thoughts: 4,
      next_step_needed: true,
      is_revision: true,
      revises_step: 1,
    });
    recordResearchStep({
      topic: "strategy comparison",
      stage: "coverage_analysis",
      note: "Paper-first branch.",
      thought_number: 4,
      total_thoughts: 4,
      next_step_needed: false,
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
      total_thoughts: 2,
      next_step_needed: true,
      criteria: [{ id: "C5", label: "Temporary criterion" }],
      sources: [{ id: "S5", title: "Temporary source" }],
      gaps: [{ id: "G5", description: "Temporary gap", severity: "blocking", resolution: "ask_user" }],
      assumptions: ["temporary assumption"],
    });
    recordResearchStep({
      topic: "reset me",
      stage: "coverage_analysis",
      note: "Temporary branch.",
      thought_number: 2,
      total_thoughts: 2,
      next_step_needed: false,
      branch_from_step: 1,
      branch_id: "temporary",
    });

    resetResearchPlanner();

    const status = getResearchStatus();
    expect(status.stepCount).toBe(0);
    expect(status.topic).toBeUndefined();
    expect(status.criteria).toEqual([]);
    expect(status.sources).toEqual([]);
    expect(status.openGaps).toEqual([]);
    expect(status.assumptions).toEqual([]);
    expect(status.branches).toEqual([]);
    expect(status.clarificationWarranted).toBe(false);

    recordResearchStep({
      topic: "after reset",
      stage: "framing",
      note: "IDs restart.",
      thought_number: 1,
      total_thoughts: 1,
      next_step_needed: false,
      criteria: [{ label: "Fresh criterion" }],
      sources: [{ title: "Fresh source" }],
      gaps: [{ description: "Fresh gap" }],
    });
    const fresh = getResearchStatus();
    expect(fresh.criteria[0].id).toBe("C1");
    expect(fresh.sources[0].id).toBe("S1");
    expect(fresh.openGaps[0].id).toBe("G1");
  });
});
