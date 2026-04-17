import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { buildStatusLines } from "./format.js";
import { getGitSnapshot } from "./git.js";
import {
	getContextLabel,
	getCwdLabel,
	getModelLabel,
	getRepoFallbackLabel,
	getThinkingLabel,
	getTokenLabel,
} from "./session.js";
import type { CommandLike, GitSnapshot, StatuslineState } from "./types.js";

function createInitialGitSnapshot(): GitSnapshot {
	return {
		repoName: null,
		branch: null,
		dirtyCount: 0,
		worktreeLabel: "no git",
	};
}

function createInitialState(): StatuslineState {
	return {
		modelLabel: "Model: none",
		thinkingLabel: "Thinking: off",
		contextLabel: "Ctx: n/a",
		tokenLabel: "↑0/↓0",
		gitSnapshot: createInitialGitSnapshot(),
		lastSkill: null,
	};
}

type StatuslineInput = {
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
};

export function extractSkillName(text: string, commands: ReadonlyArray<CommandLike>): string | null {
	const trimmed = text.trim();
	if (!trimmed.startsWith("/")) {
		return null;
	}

	const firstToken = trimmed.split(/\s+/, 1)[0]?.slice(1);
	if (!firstToken) {
		return null;
	}

	if (firstToken.startsWith("skill:")) {
		const name = firstToken.slice("skill:".length).trim();
		return name.length > 0 ? name : null;
	}

	const matchingSkill = commands.find((command) => command.source === "skill" && command.name === firstToken);
	if (!matchingSkill) {
		return null;
	}

	return matchingSkill.name.replace(/^skill:/, "");
}

function getBranchLabel(branch: string | null | undefined): string {
	return `⎇ ${branch || "no git"}`;
}

function getWorktreeLabel(worktreeLabel: string): string {
	return `𖠰 ${worktreeLabel || "no git"}`;
}

function getDirtyLabel(dirtyCount: number): string {
	return `dirty: +${dirtyCount}`;
}

function buildLines(cwd: string, state: StatuslineState, branchLabel: string | null, width?: number): string[] {
	const input: StatuslineInput = {
		modelLabel: state.modelLabel,
		thinkingLabel: state.thinkingLabel,
		contextLabel: state.contextLabel,
		branchLabel: getBranchLabel(branchLabel),
		dirtyLabel: getDirtyLabel(state.gitSnapshot.dirtyCount),
		tokenLabel: state.tokenLabel,
		repoLabel: state.gitSnapshot.repoName || getRepoFallbackLabel(cwd),
		cwdLabel: getCwdLabel(cwd),
		worktreeLabel: getWorktreeLabel(state.gitSnapshot.worktreeLabel),
		skillLabel: `Skill: ${state.lastSkill || "none"}`,
	};

	return buildStatusLines(input, width);
}

export default function statuslineExtension(pi: ExtensionAPI) {
	let state = createInitialState();
	let footerRegistered = false;

	const refreshDynamicState = (ctx: Pick<ExtensionContext, "model" | "sessionManager" | "getContextUsage">) => {
		state = {
			...state,
			modelLabel: getModelLabel(ctx.model),
			thinkingLabel: getThinkingLabel(pi.getThinkingLevel()),
			contextLabel: getContextLabel(ctx.getContextUsage(), ctx.model),
			tokenLabel: getTokenLabel(ctx.sessionManager.getBranch()),
		};
	};

	const refreshGitState = async (cwd: string) => {
		state = {
			...state,
			gitSnapshot: await getGitSnapshot(pi, cwd),
		};
	};

	const setSkill = (skillName: string | null | undefined) => {
		if (!skillName) {
			return;
		}
		state = {
			...state,
			lastSkill: skillName,
		};
	};

	const emitStatusLines = (ctx: Pick<ExtensionContext, "cwd">) => {
		const lines = buildLines(ctx.cwd, state, state.gitSnapshot.branch);
		for (const line of lines) {
			console.log(line);
		}
	};

	const updateAndLog = async (ctx: ExtensionContext, emit = true) => {
		refreshDynamicState(ctx);
		await refreshGitState(ctx.cwd);
		if (!ctx.hasUI && emit) {
			emitStatusLines(ctx);
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		state = createInitialState();
		await updateAndLog(ctx);

		if (!ctx.hasUI || footerRegistered) {
			return;
		}

		footerRegistered = true;
		ctx.ui.setFooter((tui, _theme, footerData) => ({
			dispose: footerData.onBranchChange(() => {
				void refreshGitState(ctx.cwd).then(() => tui.requestRender());
			}),
			invalidate() {},
			render(width: number): string[] {
				refreshDynamicState(ctx);
				return buildLines(ctx.cwd, state, footerData.getGitBranch(), width);
			},
		}));
	});

	pi.on("agent_end", async (_event, ctx) => {
		await updateAndLog(ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		await updateAndLog(ctx);
	});

	pi.on("input", async (event) => {
		const skillName = extractSkillName(event.text, pi.getCommands() as CommandLike[]);
		if (!skillName) {
			return { action: "continue" };
		}

		setSkill(skillName);
		return { action: "continue" };
	});

	pi.on("tool_execution_start", async (event) => {
		if (event.toolName !== "Skill" && event.toolName !== "skill") {
			return;
		}

		const args = (event as { args?: { skill?: string }; tool_input?: { skill?: string } }).args;
		const toolInput = args ?? (event as { tool_input?: { skill?: string } }).tool_input;
		if (typeof toolInput?.skill === "string" && toolInput.skill.length > 0) {
			setSkill(toolInput.skill);
		}
	});

	pi.registerTool({
		name: "statusline",
		label: "Statusline",
		description: "Show the current status line with model, thinking effort, context, git info, and token counts",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx: ExtensionContext) {
			await updateAndLog(ctx, false);
			const text = buildLines(ctx.cwd, state, state.gitSnapshot.branch).join("\n");
			return {
				content: [{ type: "text", text }],
				details: {},
		};
		},
	});
}
