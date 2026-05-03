/**
 * In-memory stateful Exa research planner.
 *
 * These helpers intentionally never call Exa network APIs. They only track and
 * summarize planning state so the model can decide which explicit retrieval
 * tool to call next.
 */

import type {
  CriteriaCoverage,
  RecommendedNextAction,
  ResearchCriterion,
  ResearchCriterionInput,
  ResearchGap,
  ResearchGapInput,
  ResearchSource,
  ResearchSourceInput,
  ResearchStatus,
  ResearchStep,
  ResearchStepInput,
  ResearchStepResult,
  ResearchSummaryParams,
  SourcePackSummary,
} from "./research-planner-types.js";

interface PlannerState {
  topic?: string;
  steps: ResearchStep[];
  criteria: ResearchCriterion[];
  sources: ResearchSource[];
  gaps: ResearchGap[];
  assumptions: string[];
  branches: Map<string, number>;
  warnings: string[];
  nextCriterionId: number;
  nextSourceId: number;
  nextGapId: number;
}

const state: PlannerState = createEmptyState();

function createEmptyState(): PlannerState {
  return {
    steps: [],
    criteria: [],
    sources: [],
    gaps: [],
    assumptions: [],
    branches: new Map(),
    warnings: [],
    nextCriterionId: 1,
    nextSourceId: 1,
    nextGapId: 1,
  };
}

function replaceState(next: PlannerState): void {
  state.topic = next.topic;
  state.steps = next.steps;
  state.criteria = next.criteria;
  state.sources = next.sources;
  state.gaps = next.gaps;
  state.assumptions = next.assumptions;
  state.branches = next.branches;
  state.warnings = next.warnings;
  state.nextCriterionId = next.nextCriterionId;
  state.nextSourceId = next.nextSourceId;
  state.nextGapId = next.nextGapId;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function nextId(prefix: "C" | "S" | "G"): string {
  if (prefix === "C") {
    return `${prefix}${state.nextCriterionId++}`;
  }
  if (prefix === "S") {
    return `${prefix}${state.nextSourceId++}`;
  }
  return `${prefix}${state.nextGapId++}`;
}

function reserveExplicitId(prefix: "C" | "S" | "G", id?: string): void {
  if (!id?.startsWith(prefix)) {
    return;
  }
  const numericSuffix = Number(id.slice(1));
  if (!Number.isInteger(numericSuffix) || numericSuffix < 1) {
    return;
  }
  if (prefix === "C") {
    state.nextCriterionId = Math.max(state.nextCriterionId, numericSuffix + 1);
  } else if (prefix === "S") {
    state.nextSourceId = Math.max(state.nextSourceId, numericSuffix + 1);
  } else {
    state.nextGapId = Math.max(state.nextGapId, numericSuffix + 1);
  }
}

function findCriterion(input: ResearchCriterionInput): ResearchCriterion | undefined {
  return state.criteria.find((criterion) => criterion.id === input.id || criterion.label === input.label);
}

function normalizeCriterion(input: ResearchCriterionInput, existing?: ResearchCriterion): ResearchCriterion {
  reserveExplicitId("C", input.id);
  return {
    id: existing?.id ?? input.id ?? nextId("C"),
    label: input.label,
    category: input.category ?? existing?.category ?? "other",
    description: input.description ?? existing?.description,
    priority: input.priority ?? existing?.priority ?? "medium",
    status: input.status ?? existing?.status ?? "proposed",
    evidenceRefs: uniqueStrings([...(existing?.evidenceRefs ?? []), ...(input.evidenceRefs ?? [])]),
    evidenceIssues: [],
  };
}

function findSource(input: ResearchSourceInput): ResearchSource | undefined {
  return state.sources.find((source) => source.id === input.id || (input.url && source.url === input.url));
}

function normalizeSource(input: ResearchSourceInput, existing?: ResearchSource): ResearchSource {
  reserveExplicitId("S", input.id);
  return {
    id: existing?.id ?? input.id ?? nextId("S"),
    title: input.title,
    url: input.url ?? existing?.url,
    sourceType: input.sourceType ?? existing?.sourceType ?? "other",
    retrievalStatus: input.retrievalStatus ?? existing?.retrievalStatus ?? "discovered_only",
    retrievalEvidence: input.retrievalEvidence ?? existing?.retrievalEvidence,
    usedFor: uniqueStrings([...(existing?.usedFor ?? []), ...(input.usedFor ?? [])]),
    contentNotes: input.contentNotes ?? existing?.contentNotes,
    qualityNotes: input.qualityNotes ?? existing?.qualityNotes,
    inspectionIssues: [],
  };
}

function findGap(input: ResearchGapInput): ResearchGap | undefined {
  return state.gaps.find((gap) => gap.id === input.id || gap.description === input.description);
}

function normalizeGap(input: ResearchGapInput, existing?: ResearchGap): ResearchGap {
  reserveExplicitId("G", input.id);
  return {
    id: existing?.id ?? input.id ?? nextId("G"),
    description: input.description,
    severity: input.severity ?? existing?.severity ?? "important",
    resolution: input.resolution ?? existing?.resolution ?? "search_more",
  };
}

function isExplicitToolEvidence(ref: string): boolean {
  return /^tool:(web_[a-z_]+_exa|exa_research_[a-z_]+)[:#\s]+\S+/i.test(ref) || /^web_[a-z_]+_exa[:#\s]+\S+/i.test(ref);
}

function validateEvidence(): void {
  const sourceIds = new Set(state.sources.map((source) => source.id));
  for (const criterion of state.criteria) {
    criterion.evidenceIssues = criterion.evidenceRefs
      .filter((ref) => !sourceIds.has(ref) && !isExplicitToolEvidence(ref))
      .map((ref) => `Unresolved evidence ref: ${ref}`);

    if (criterion.status === "supported" && criterion.evidenceRefs.length === 0) {
      criterion.evidenceIssues.push("Supported criterion has no evidence refs.");
    }
  }
}

function validateSources(): void {
  for (const source of state.sources) {
    source.inspectionIssues = [];
    if (source.retrievalStatus === "discovered_only" && source.contentNotes) {
      source.inspectionIssues.push(
        "Content notes are metadata/snippet-derived; source content was not directly inspected.",
      );
    }
    if (source.retrievalStatus === "fetched" && !source.retrievalEvidence) {
      source.inspectionIssues.push("Fetched source is missing retrieval evidence.");
    }
  }
}

function mergeCriteria(inputs: ResearchCriterionInput[] = []): string[] {
  const warnings: string[] = [];
  for (const input of inputs) {
    const existing = findCriterion(input);
    if (existing && input.id !== undefined && existing.id === input.id && existing.label !== input.label) {
      warnings.push(
        `Criterion ${existing.id} already exists as "${existing.label}"; conflicting label "${input.label}" was ignored.`,
      );
      continue;
    }
    const normalized = normalizeCriterion(input, existing);
    if (existing) {
      Object.assign(existing, normalized);
    } else {
      state.criteria.push(normalized);
    }
  }
  return warnings;
}

function mergeSources(inputs: ResearchSourceInput[] = []): string[] {
  const warnings: string[] = [];
  for (const input of inputs) {
    const existing = findSource(input);
    if (
      existing &&
      input.id !== undefined &&
      existing.id === input.id &&
      existing.url &&
      input.url &&
      existing.url !== input.url
    ) {
      warnings.push(
        `Source ${existing.id} already exists for ${existing.url}; conflicting URL ${input.url} was ignored.`,
      );
      continue;
    }
    const normalized = normalizeSource(input, existing);
    if (existing) {
      Object.assign(existing, normalized);
    } else {
      state.sources.push(normalized);
    }
  }
  return warnings;
}

function mergeGaps(inputs: ResearchGapInput[] = []): string[] {
  const warnings: string[] = [];
  for (const input of inputs) {
    const existing = findGap(input);
    if (existing && input.id !== undefined && existing.id === input.id && existing.description !== input.description) {
      warnings.push(
        `Gap ${existing.id} already exists as "${existing.description}"; conflicting description "${input.description}" was ignored.`,
      );
      continue;
    }
    const normalized = normalizeGap(input, existing);
    if (existing) {
      Object.assign(existing, normalized);
    } else {
      state.gaps.push(normalized);
    }
  }
  return warnings;
}

function validateStepReferences(input: ResearchStepInput): string[] {
  const warnings: string[] = [];
  const knownSteps = new Set(state.steps.map((step) => step.thought_number));
  const lastStep = state.steps.at(-1);

  if (knownSteps.has(input.thought_number)) {
    warnings.push(`Duplicate thought_number ${input.thought_number}; step was not recorded.`);
  }
  if (lastStep && input.thought_number < lastStep.thought_number) {
    warnings.push(
      `Out-of-order thought_number ${input.thought_number}; last recorded thought_number is ${lastStep.thought_number}. Step was not recorded.`,
    );
  }

  if (input.is_revision && input.revises_step === undefined) {
    warnings.push("Revision steps require revises_step.");
  }
  if (!input.is_revision && input.revises_step !== undefined) {
    warnings.push("revises_step requires is_revision true.");
  }
  if (input.is_revision && (input.branch_from_step !== undefined || input.branch_id !== undefined)) {
    warnings.push("Revision steps cannot also define branch metadata.");
  }
  if (input.branch_from_step !== undefined && input.branch_id === undefined) {
    warnings.push("branch_from_step requires branch_id.");
  }
  if (input.branch_id !== undefined && input.branch_from_step === undefined) {
    warnings.push("branch_id requires branch_from_step.");
  }
  if (input.is_revision && input.revises_step !== undefined && !knownSteps.has(input.revises_step)) {
    warnings.push(`Revision references unknown step ${input.revises_step}.`);
  }
  if (input.branch_from_step !== undefined && !knownSteps.has(input.branch_from_step)) {
    warnings.push(`Branch references unknown step ${input.branch_from_step}.`);
  }
  return warnings;
}

function coverageSummary(): CriteriaCoverage {
  return {
    total: state.criteria.length,
    supported: state.criteria.filter(
      (criterion) => criterion.status === "supported" && criterion.evidenceIssues.length === 0,
    ).length,
    missing: state.criteria.filter((criterion) => criterion.status === "missing").length,
    conflicting: state.criteria.filter((criterion) => criterion.status === "conflicting").length,
    proposed: state.criteria.filter((criterion) => criterion.status === "proposed").length,
    searched: state.criteria.filter((criterion) => criterion.status === "searched").length,
    excluded: state.criteria.filter((criterion) => criterion.status === "excluded").length,
    unresolvedEvidence: state.criteria.filter((criterion) => criterion.evidenceIssues.length > 0).length,
  };
}

function sourceSummary(): SourcePackSummary {
  return {
    total: state.sources.length,
    fetched: state.sources.filter((source) => source.retrievalStatus === "fetched" && source.retrievalEvidence).length,
    discoveredOnly: state.sources.filter((source) => source.retrievalStatus === "discovered_only").length,
    fetchFailed: state.sources.filter((source) => source.retrievalStatus === "fetch_failed").length,
    unavailable: state.sources.filter((source) => source.retrievalStatus === "unavailable").length,
    notDirectlyInspected: state.sources.filter(
      (source) => source.retrievalStatus !== "fetched" || !source.retrievalEvidence,
    ).length,
  };
}

function lastRecommendedAction(): RecommendedNextAction | undefined {
  for (const step of [...state.steps].reverse()) {
    if (step.nextAction) {
      return { action: step.nextAction, reason: step.nextActionReason };
    }
  }
  return undefined;
}

function currentProgress() {
  const last = state.steps.at(-1);
  const current = last?.thought_number ?? 0;
  const total = Math.max(last?.total_thoughts ?? 0, current);
  return {
    current,
    total,
    percent: total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0,
    complete: last ? !last.next_step_needed : false,
  };
}

function snapshotStep(step: ResearchStep): ResearchStep {
  return {
    ...step,
    criteria: step.criteria?.map((criterion) => ({
      ...criterion,
      evidenceRefs: criterion.evidenceRefs ? [...criterion.evidenceRefs] : undefined,
    })),
    sources: step.sources?.map((source) => ({
      ...source,
      usedFor: source.usedFor ? [...source.usedFor] : undefined,
    })),
    gaps: step.gaps?.map((gap) => ({ ...gap })),
    assumptions: step.assumptions ? [...step.assumptions] : undefined,
    warnings: [...step.warnings],
  };
}

function planFragment(status: ResearchStatus): string {
  const next = status.recommendedNextAction
    ? `${status.recommendedNextAction.action}${status.recommendedNextAction.reason ? ` — ${status.recommendedNextAction.reason}` : ""}`
    : "record the next planning step";
  return [
    `Topic: ${status.topic ?? "(none)"}`,
    `Stage: ${status.activeStage ?? "not started"}`,
    `Progress: ${status.progress.percent}% (${status.progress.current}/${status.progress.total})`,
    `Criteria: ${status.criteriaCoverage.supported}/${status.criteriaCoverage.total} supported`,
    `Sources: ${status.sourcePackSummary.fetched}/${status.sourcePackSummary.total} fetched`,
    `Next action: ${next}`,
  ].join("\n");
}

export function recordResearchStep(input: ResearchStepInput): ResearchStepResult {
  const warnings = validateStepReferences(input);
  const isTopicMismatch = Boolean(state.topic && state.topic !== input.topic);
  const isInvalidReference = warnings.some(
    (warning) =>
      warning.startsWith("Revision references unknown") ||
      warning.startsWith("Branch references unknown") ||
      warning === "Revision steps require revises_step." ||
      warning === "revises_step requires is_revision true." ||
      warning === "Revision steps cannot also define branch metadata." ||
      warning === "branch_from_step requires branch_id." ||
      warning === "branch_id requires branch_from_step.",
  );
  const isInvalidSequence = warnings.some((warning) => warning.toLowerCase().includes("step was not recorded"));

  if (isTopicMismatch) {
    warnings.push(
      `Topic mismatch: active topic is "${state.topic}"; received "${input.topic}". Call exa_research_reset before starting a new topic. Step was not recorded.`,
    );
  }

  const step: ResearchStep = { ...input, sequence: state.steps.length + 1, warnings };
  if (isTopicMismatch || isInvalidSequence || isInvalidReference) {
    const status = getResearchStatus();
    const resultStatus = { ...status, warnings: uniqueStrings([...status.warnings, ...warnings]) };
    return { ...resultStatus, step: snapshotStep(step), planFragment: planFragment(resultStatus) };
  }

  if (!state.topic) {
    state.topic = input.topic;
  }

  warnings.push(...mergeSources(input.sources));
  warnings.push(...mergeCriteria(input.criteria));
  warnings.push(...mergeGaps(input.gaps));
  state.assumptions = uniqueStrings([...state.assumptions, ...(input.assumptions ?? [])]);

  if (input.branch_id && input.branch_from_step !== undefined) {
    state.branches.set(input.branch_id, input.branch_from_step);
  }

  state.steps.push(snapshotStep(step));
  state.warnings = uniqueStrings([...state.warnings, ...warnings]);

  validateEvidence();
  validateSources();

  const status = getResearchStatus();
  return { ...status, step: snapshotStep(step), planFragment: planFragment(status) };
}

function snapshotCriteria(): ResearchCriterion[] {
  return state.criteria.map((criterion) => ({
    ...criterion,
    evidenceRefs: [...criterion.evidenceRefs],
    evidenceIssues: [...criterion.evidenceIssues],
  }));
}

function snapshotSources(): ResearchSource[] {
  return state.sources.map((source) => ({
    ...source,
    usedFor: [...source.usedFor],
    inspectionIssues: [...source.inspectionIssues],
  }));
}

export function getResearchStatus(): ResearchStatus {
  const openGaps = state.gaps.filter((gap) => gap.resolution !== "exclude");
  return {
    topic: state.topic,
    stepCount: state.steps.length,
    activeStage: state.steps.at(-1)?.stage,
    progress: currentProgress(),
    branches: [...state.branches.keys()],
    revisions: state.steps.flatMap((step) =>
      step.is_revision && step.revises_step !== undefined
        ? [{ step: step.thought_number, revisesStep: step.revises_step }]
        : [],
    ),
    criteriaCoverage: coverageSummary(),
    sourcePackSummary: sourceSummary(),
    criteria: snapshotCriteria(),
    sources: snapshotSources(),
    openGaps: openGaps.map((gap) => ({ ...gap })),
    assumptions: [...state.assumptions],
    recommendedNextAction: lastRecommendedAction(),
    clarificationWarranted: openGaps.some((gap) => gap.severity === "blocking" && gap.resolution === "ask_user"),
    warnings: [...state.warnings],
  };
}

function formatCriteria(status: ResearchStatus): string {
  if (status.criteria.length === 0) {
    return "- No criteria recorded yet.";
  }
  return status.criteria
    .map((criterion) => {
      const evidence = criterion.evidenceRefs.length > 0 ? criterion.evidenceRefs.join(", ") : "none";
      const issues = criterion.evidenceIssues.length > 0 ? ` Issues: ${criterion.evidenceIssues.join("; ")}` : "";
      return `- ${criterion.id} ${criterion.label} (${criterion.priority}, ${criterion.status}, ${criterion.category}) — evidence: ${evidence}.${issues}`;
    })
    .join("\n");
}

function formatSources(status: ResearchStatus): string {
  if (status.sources.length === 0) {
    return "- No sources recorded yet.";
  }
  return status.sources
    .map((source) => {
      const inspected =
        source.retrievalStatus === "fetched" && source.retrievalEvidence
          ? "directly inspected"
          : "not directly inspected";
      const issues = source.inspectionIssues.length > 0 ? ` Issues: ${source.inspectionIssues.join("; ")}` : "";
      const url = source.url ? ` — ${source.url}` : "";
      const notes = source.contentNotes ? ` Notes: ${source.contentNotes}` : "";
      return `- ${source.id} ${source.title} (${source.sourceType}, ${source.retrievalStatus}, ${inspected})${url}.${notes}${issues}`;
    })
    .join("\n");
}

function formatGaps(status: ResearchStatus): string {
  if (status.openGaps.length === 0) {
    return "- No open gaps recorded.";
  }
  return status.openGaps
    .map((gap) => `- ${gap.id} ${gap.description} (${gap.severity}, resolution: ${gap.resolution})`)
    .join("\n");
}

function executionPlan(status: ResearchStatus): string {
  const next = status.recommendedNextAction
    ? `${status.recommendedNextAction.action}${status.recommendedNextAction.reason ? ` — ${status.recommendedNextAction.reason}` : ""}`
    : "Record another planning step or finalize the research plan.";

  return [
    "# Research Execution Plan",
    "",
    `## Objective\n${status.topic ?? "No active research topic."}`,
    "",
    `## Progress\n${status.progress.percent}% complete (${status.progress.current}/${status.progress.total} steps). Active stage: ${status.activeStage ?? "not started"}.`,
    "",
    "## Criteria Coverage",
    formatCriteria(status),
    "",
    "## Source Strategy",
    formatSources(status),
    "",
    "## Open Gaps",
    formatGaps(status),
    "",
    "## Assumptions",
    status.assumptions.length > 0
      ? status.assumptions.map((assumption) => `- ${assumption}`).join("\n")
      : "- None recorded.",
    "",
    "## Recommended Next Action",
    next,
  ].join("\n");
}

function brief(status: ResearchStatus): string {
  return [
    "# Research Planning Brief",
    "",
    `- Objective: ${status.topic ?? "No active research topic."}`,
    `- Stage: ${status.activeStage ?? "not started"}`,
    `- Criteria: ${status.criteriaCoverage.supported}/${status.criteriaCoverage.total} supported; ${status.criteriaCoverage.unresolvedEvidence} with evidence issues`,
    `- Sources: ${status.sourcePackSummary.fetched}/${status.sourcePackSummary.total} fetched; ${status.sourcePackSummary.notDirectlyInspected} not directly inspected`,
    `- Open gaps: ${status.openGaps.length}`,
    `- Next action: ${status.recommendedNextAction?.action ?? "record next step"}`,
  ].join("\n");
}

function sourcePack(status: ResearchStatus): string {
  return ["# Source Pack", "", `Topic: ${status.topic ?? "No active research topic."}`, "", formatSources(status)].join(
    "\n",
  );
}

function payload(status: ResearchStatus): string {
  const systemPrompt = [
    "Use the recorded criteria, assumptions, source strategy, and gaps from the human-reviewed research plan.",
    "Prefer directly inspected fetched sources over discovered-only metadata when claims conflict.",
  ].join(" ");
  const queryParts = [
    status.topic ?? "",
    ...status.criteria.map((criterion) => criterion.label),
    ...status.openGaps.filter((gap) => gap.resolution !== "ask_user").map((gap) => gap.description),
  ].filter((part) => part.length > 0);
  const suggestedPayload = {
    query: queryParts.join("; ") || "Research the recorded topic.",
    systemPrompt,
    additionalQueries: status.criteria.slice(0, 5).map((criterion) => criterion.label),
    numResults: Math.min(20, Math.max(5, status.criteria.length + status.sources.length)),
  };

  return [
    executionPlan(status),
    "",
    "## Implementation payload",
    "This payload is a suggestion only; no Exa retrieval call was executed.",
    "",
    "```json",
    JSON.stringify(suggestedPayload, null, 2),
    "```",
  ].join("\n");
}

export function getResearchSummary(params: ResearchSummaryParams = {}): string {
  const status = getResearchStatus();
  switch (params.mode ?? "brief") {
    case "execution_plan":
      return executionPlan(status);
    case "source_pack":
      return sourcePack(status);
    case "payload":
      return payload(status);
    default:
      return brief(status);
  }
}

export function resetResearchPlanner(): ResearchStatus {
  replaceState(createEmptyState());
  return getResearchStatus();
}
