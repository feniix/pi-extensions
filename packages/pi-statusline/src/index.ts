/**
 * pi-statusline: Gather session data and render the two-line status line.
 *
 * Model, context %, and thinking level come from the extension's ExtensionContext (ctx API).
 * Git data and transcript parsing are done from the filesystem.
 */

import { homedir } from "node:os";
import { getGitData } from "./data/git.js";
import { findTranscriptPath, getRepoRoot } from "./data/session.js";
import { parseTranscript } from "./data/transcript.js";
import { C, formatContextPct, formatTokenPair, joinWidgets } from "./format.js";
import type { GitData, StatusLineData, ThinkingEffort } from "./types.js";

/** Separator between the two rendered lines */
const LINE_BREAK = "\n";

// ============================================================================
// Data gathering
// ============================================================================

export interface GatheredData {
	repoRoot: string | null;
	git: GitData;
	transcriptTokens: { inputTokens: number; outputTokens: number } | null;
}

/**
 * Gather git and transcript data from the filesystem.
 * Model, context %, and thinking level come from the extension's ExtensionContext.
 */
export async function gatherStatusData(cwd?: string, skipTranscript = false): Promise<GatheredData> {
	const workingDir = cwd ?? process.cwd();

	const [repoRoot, git] = await Promise.all([Promise.resolve(getRepoRoot(workingDir)), getGitData(workingDir)]);

	let transcriptTokens: { inputTokens: number; outputTokens: number } | null = null;

	if (!skipTranscript) {
		const transcriptPath = findTranscriptPath(repoRoot, workingDir);
		if (transcriptPath) {
			try {
				const metrics = await parseTranscript(transcriptPath);
				transcriptTokens = {
					inputTokens: metrics.tokens.inputTokens,
					outputTokens: metrics.tokens.outputTokens,
				};
			} catch {
				// Transcript parse failed — continue with null
			}
		}
	}

	return { repoRoot, git, transcriptTokens };
}

// ============================================================================
// Widget formatters
// ============================================================================

function widgetModel(data: StatusLineData): string {
	const model = data.model ?? "?";
	return `${C.cyan("Model:")} ${C.cyan(model)}`;
}

function widgetThinking(data: StatusLineData): string {
	const effort: ThinkingEffort = data.thinkingLevel ?? "medium";
	return `${C.magenta("Thinking:")} ${C.magenta(effort)}`;
}

function widgetContext(data: StatusLineData): string {
	const pct = formatContextPct(data.contextPct);
	return `${C.blue("Ctx:")} ${C.blue(`${pct}%`)}`;
}

function widgetBranch(data: StatusLineData): string {
	const branch = data.git.branch ?? "no git";
	return `${C.magenta("⎇")} ${C.magenta(branch)}`;
}

function widgetDirty(data: StatusLineData): string {
	const dirty = data.git.dirty;
	return `${C.yellow("dirty:")} ${C.yellow(`+${dirty}`)}`;
}

function widgetTokens(data: StatusLineData): string {
	if (!data.transcriptTokens) {
		return `${C.cyan("Tokens:")} ${C.brightBlack("↑0/↓0")}`;
	}
	const { inputTokens, outputTokens } = data.transcriptTokens;
	return `${C.cyan("Tokens:")} ${C.cyan(formatTokenPair(inputTokens, outputTokens))}`;
}

function widgetProjectName(data: StatusLineData): string {
	return C.blue(data.repoName ?? "?");
}

function widgetCwd(data: StatusLineData): string {
	const home = homedir();
	const display = data.cwd.startsWith(home) ? `~${data.cwd.slice(home.length)}` : data.cwd;
	return `${C.blue("cwd:")} ${C.blue(display)}`;
}

function widgetWorktree(data: StatusLineData): string {
	const worktree = data.git.worktree ?? "no git";
	return `${C.blue("𖠰")} ${C.blue(worktree)}`;
}

function widgetSkill(lastSkill: string | null): string {
	const skill = lastSkill ?? "none";
	return `${C.brightBlack("Skill:")} ${C.brightBlack(skill)}`;
}

// ============================================================================
// Rendering
// ============================================================================

/** Render line 1 of the status line. */
function renderLine1(data: StatusLineData): string {
	return joinWidgets(
		widgetModel(data),
		widgetThinking(data),
		widgetContext(data),
		widgetBranch(data),
		widgetDirty(data),
		widgetTokens(data),
	);
}

/** Render line 2 of the status line. */
function renderLine2(data: StatusLineData, lastSkill: string | null): string {
	return joinWidgets(widgetProjectName(data), widgetCwd(data), widgetWorktree(data), widgetSkill(lastSkill));
}

/**
 * Render the full two-line status line.
 *
 * @param gathered - Git and transcript data from gatherStatusData()
 * @param params  - Context-derived values (model, contextPct, thinkingLevel, cwd, repoName)
 * @param lastSkill - Last skill invoked (tracked by the extension via tool_execution_end)
 */
export function renderStatusLine(
	gathered: GatheredData,
	params: {
		cwd: string;
		repoName: string | null;
		model: string | null;
		contextPct: number | null;
		thinkingLevel: ThinkingEffort | null;
	},
	lastSkill: string | null,
): string {
	const data: StatusLineData = {
		cwd: params.cwd,
		repoRoot: gathered.repoRoot,
		repoName: params.repoName,
		git: gathered.git,
		transcriptTokens: gathered.transcriptTokens,
		model: params.model,
		contextPct: params.contextPct,
		thinkingLevel: params.thinkingLevel,
	};

	return [renderLine1(data), renderLine2(data, lastSkill)].join(LINE_BREAK);
}
