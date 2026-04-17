import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
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
		dirtyCount: null,
		worktreeLabel: "none",
	};
}

function createInitialState(cwd: string): StatuslineState {
	return {
		modelLabel: "Model: none",
		thinkingLabel: "Thinking: off",
		contextLabel: "Ctx: n/a",
		tokenLabel: "↑0 ↓0",
		cwdLabel: getCwdLabel(cwd),
		gitSnapshot: createInitialGitSnapshot(),
		lastSkill: null,
	};
}

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

export default function statuslineExtension(pi: ExtensionAPI) {
	let state = createInitialState(process.cwd());
	let footerRegistered = false;

	const refreshDynamicState = (ctx: Pick<ExtensionContext, "cwd" | "model" | "sessionManager" | "getContextUsage">) => {
		state = {
			...state,
			modelLabel: getModelLabel(ctx.model),
			thinkingLabel: getThinkingLabel(pi.getThinkingLevel()),
			contextLabel: getContextLabel(ctx.getContextUsage(), ctx.model),
			tokenLabel: getTokenLabel(ctx.sessionManager.getBranch()),
			cwdLabel: getCwdLabel(ctx.cwd),
		};
	};

	const refreshGitState = async (cwd: string) => {
		state = {
			...state,
			gitSnapshot: await getGitSnapshot(pi, cwd),
		};
	};

	pi.on("session_start", async (_event, ctx) => {
		state = createInitialState(ctx.cwd);
		refreshDynamicState(ctx);
		await refreshGitState(ctx.cwd);

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

				const branch = footerData.getGitBranch();
				const dirtyValue = state.gitSnapshot.dirtyCount;
				const input = {
					modelLabel: state.modelLabel,
					thinkingLabel: state.thinkingLabel,
					contextLabel: state.contextLabel,
					branchLabel: `⎇ ${branch || "none"}`,
					dirtyLabel: dirtyValue === null ? "dirty: n/a" : `dirty: +${dirtyValue}`,
					tokenLabel: state.tokenLabel,
					repoLabel: state.gitSnapshot.repoName || getRepoFallbackLabel(ctx.cwd),
					cwdLabel: state.cwdLabel,
					worktreeLabel: `𖠰 ${state.gitSnapshot.worktreeLabel || "none"}`,
					skillLabel: `Skill: ${state.lastSkill || "none"}`,
				};

				return buildStatusLines(input, width);
			},
		}));
	});

	pi.on("model_select", async (_event, ctx) => {
		refreshDynamicState(ctx);
	});

	pi.on("turn_end", async (_event, ctx) => {
		refreshDynamicState(ctx);
		await refreshGitState(ctx.cwd);
	});

	pi.on("input", async (event) => {
		const skillName = extractSkillName(event.text, pi.getCommands() as CommandLike[]);
		if (!skillName) {
			return { action: "continue" };
		}

		state = {
			...state,
			lastSkill: skillName,
		};
		return { action: "continue" };
	});
}
