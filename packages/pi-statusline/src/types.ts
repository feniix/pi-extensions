/**
 * Shared types for pi-statusline
 */

export interface TokenData {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

export interface TranscriptMetrics {
	tokens: TokenData;
	thinkingEffort: ThinkingEffort | null;
	lastSkill: string | null;
}

export interface GitData {
	branch: string | null;
	worktree: string | null;
	dirty: number;
}

export type ThinkingEffort = "low" | "medium" | "high" | "max";

export interface StatusLineData {
	/** Current working directory */
	cwd: string;
	/** Git repo root directory */
	repoRoot: string | null;
	/** Name of the git repo (last path segment of repoRoot) */
	repoName: string | null;
	git: GitData;
	/** Input/output token pair from transcript parsing */
	transcriptTokens: { inputTokens: number; outputTokens: number } | null;
	/** Model display name, e.g. "Opus 4.6 (1M context)" */
	model: string | null;
	/** Context window usage percentage (0-100), e.g. 11.0 */
	contextPct: number | null;
	/** Current thinking level */
	thinkingLevel: ThinkingEffort | null;
}
