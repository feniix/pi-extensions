export interface TokenTotals {
  input: number;
  output: number;
}

export interface GitSnapshot {
  repoName: string | null;
  branch: string | null;
  dirtyCount: number;
  worktreeLabel: string;
}

export interface AssistantUsageLike {
  input?: number;
  output?: number;
}

export type ActivityPhase = "idle" | "queued" | "running" | "thinking" | "responding" | "tool";

export interface StatuslinePalette {
  background: string;
  model: string;
  repo: string;
  thinking: string;
  skill: string;
  context: string;
  branch: string;
  dirty: string;
  token: string;
  separators: string;
  cwd: string;
  worktree: string;
  activity: string;
}

export type StatuslinePaletteInput = Partial<Record<keyof StatuslinePalette, unknown>>;

export interface StatuslineConfig {
  palette?: StatuslinePaletteInput;
}

export interface StatuslineState {
  modelLabel: string;
  thinkingLabel: string;
  contextLabel: string;
  tokenLabel: string;
  gitSnapshot: GitSnapshot;
  lastSkill: string | null;
  activityLabel: string;
  activityPhase: ActivityPhase;
  activeToolCount: number;
  activeToolName: string | null;
  liveAssistantUsage: AssistantUsageLike | null;
}

export interface StatuslineLinesInput {
  modelLabel: string;
  thinkingLabel: string;
  contextLabel: string;
  branchLabel: string;
  dirtyLabel: string;
  tokenLabel: string;
  repoLabel: string;
  cwdLabel: string;
  worktreeLabel: string;
  skillLabel: string;
  activityLabel: string;
}

export interface MinimalModel {
  id?: string;
  name?: string;
  contextWindow?: number;
}

export interface ContextUsageLike {
  tokens?: number | null;
  percent?: number | null;
  contextWindow?: number | null;
}

export interface SessionEntryLike {
  type?: string;
  message?: {
    role?: string;
    usage?: AssistantUsageLike;
  };
}

export interface WorktreeEntry {
  path: string;
  branch: string | null;
}

export interface CommandLike {
  name: string;
  source: string;
}
