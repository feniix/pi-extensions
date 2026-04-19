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

export interface StatuslineState {
  modelLabel: string;
  thinkingLabel: string;
  contextLabel: string;
  tokenLabel: string;
  gitSnapshot: GitSnapshot;
  lastSkill: string | null;
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

export interface AssistantUsageLike {
  input?: number;
  output?: number;
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
