/**
 * Types for stateful Exa research planning tools.
 */

export const RESEARCH_STAGES = [
  "framing",
  "criteria_discovery",
  "cheap_discovery",
  "source_retrieval",
  "coverage_analysis",
  "deep_research_plan",
  "synthesis_plan",
  "conclusion",
] as const;

export type ResearchStage = (typeof RESEARCH_STAGES)[number];

export const RESEARCH_NEXT_ACTIONS = [
  "ask_user",
  "web_search_exa",
  "web_search_advanced_exa",
  "web_fetch_exa",
  "web_find_similar_exa",
  "web_answer_exa",
  "web_research_exa",
  "draft_plan",
  "finalize",
] as const;

export type ResearchNextAction = (typeof RESEARCH_NEXT_ACTIONS)[number];

export const CRITERION_CATEGORIES = [
  "method",
  "metric",
  "source_class",
  "population",
  "market",
  "risk",
  "contrarian",
  "timeframe",
  "geography",
  "use_case",
  "other",
] as const;

export type CriterionCategory = (typeof CRITERION_CATEGORIES)[number];

export const PRIORITIES = ["high", "medium", "low"] as const;
export type ResearchPriority = (typeof PRIORITIES)[number];

export const CRITERION_STATUSES = ["proposed", "searched", "supported", "conflicting", "missing", "excluded"] as const;

export type CriterionStatus = (typeof CRITERION_STATUSES)[number];

export const SOURCE_TYPES = [
  "paper",
  "white_paper",
  "pdf",
  "official_doc",
  "filing",
  "news",
  "blog",
  "github",
  "forum",
  "analyst_report",
  "other",
] as const;

export type ResearchSourceType = (typeof SOURCE_TYPES)[number];

export const RETRIEVAL_STATUSES = ["discovered_only", "fetched", "fetch_failed", "unavailable"] as const;
export type RetrievalStatus = (typeof RETRIEVAL_STATUSES)[number];

export const GAP_SEVERITIES = ["blocking", "important", "minor"] as const;
export type GapSeverity = (typeof GAP_SEVERITIES)[number];

export const GAP_RESOLUTIONS = ["ask_user", "search_more", "fetch_source", "carry_assumption", "exclude"] as const;
export type GapResolution = (typeof GAP_RESOLUTIONS)[number];

export const SUMMARY_MODES = ["brief", "execution_plan", "source_pack", "payload"] as const;
export type ResearchSummaryMode = (typeof SUMMARY_MODES)[number];

export interface ResearchCriterionInput {
  id?: string;
  label: string;
  category?: CriterionCategory;
  description?: string;
  priority?: ResearchPriority;
  status?: CriterionStatus;
  evidenceRefs?: string[];
}

export interface ResearchCriterion
  extends Required<Omit<ResearchCriterionInput, "id" | "description" | "evidenceRefs">> {
  id: string;
  description?: string;
  evidenceRefs: string[];
  evidenceIssues: string[];
}

export interface ResearchSourceInput {
  id?: string;
  title: string;
  url?: string;
  sourceType?: ResearchSourceType;
  retrievalStatus?: RetrievalStatus;
  retrievalEvidence?: string;
  usedFor?: string[];
  contentNotes?: string;
  qualityNotes?: string;
}

export interface ResearchSource
  extends Required<
    Omit<ResearchSourceInput, "id" | "url" | "retrievalEvidence" | "usedFor" | "contentNotes" | "qualityNotes">
  > {
  id: string;
  url?: string;
  retrievalEvidence?: string;
  usedFor: string[];
  contentNotes?: string;
  qualityNotes?: string;
  inspectionIssues: string[];
}

export interface ResearchGapInput {
  id?: string;
  description: string;
  severity?: GapSeverity;
  resolution?: GapResolution;
}

export interface ResearchGap extends Required<Omit<ResearchGapInput, "id">> {
  id: string;
}

export interface ResearchStepInput {
  topic: string;
  stage: ResearchStage;
  note: string;
  criteria?: ResearchCriterionInput[];
  sources?: ResearchSourceInput[];
  gaps?: ResearchGapInput[];
  assumptions?: string[];
  nextAction?: ResearchNextAction;
  nextActionReason?: string;
  thought_number: number;
  total_thoughts: number;
  next_step_needed: boolean;
  is_revision?: boolean;
  revises_step?: number;
  branch_from_step?: number;
  branch_id?: string;
}

export interface ResearchStep extends ResearchStepInput {
  sequence: number;
  warnings: string[];
}

export interface RecommendedNextAction {
  action: ResearchNextAction;
  reason?: string;
}

export interface CriteriaCoverage {
  total: number;
  supported: number;
  missing: number;
  conflicting: number;
  proposed: number;
  searched: number;
  excluded: number;
  unresolvedEvidence: number;
}

export interface SourcePackSummary {
  total: number;
  fetched: number;
  discoveredOnly: number;
  fetchFailed: number;
  unavailable: number;
  notDirectlyInspected: number;
}

export interface ResearchRevision {
  step: number;
  revisesStep: number;
}

export interface ResearchStatus {
  topic?: string;
  stepCount: number;
  activeStage?: ResearchStage;
  progress: { current: number; total: number; percent: number; complete: boolean };
  branches: string[];
  revisions: ResearchRevision[];
  criteriaCoverage: CriteriaCoverage;
  sourcePackSummary: SourcePackSummary;
  criteria: ResearchCriterion[];
  sources: ResearchSource[];
  openGaps: ResearchGap[];
  assumptions: string[];
  recommendedNextAction?: RecommendedNextAction;
  clarificationWarranted: boolean;
  warnings: string[];
}

export interface ResearchStepResult extends ResearchStatus {
  step: ResearchStep;
  planFragment: string;
}

export interface ResearchSummaryParams {
  mode?: ResearchSummaryMode;
}
