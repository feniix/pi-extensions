/**
 * pi-statusline extension entry point.
 *
 * Renders a two-line status bar in the terminal footer (interactive mode)
 * or via console.log (RPC/print mode).
 *
 * Widgets: Model | Thinking | Ctx% | GitBranch | dirty | Tokens
 *          ProjectName | cwd | worktree | Skill
 *
 * Data sources:
 * - Model, context %, thinking level: from ExtensionContext (ctx API)
 * - Git data: git commands
 * - Tokens: tracked via agent_end events (accumulated during session)
 * - Skills: tracked via tool_execution_start events
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { gatherStatusData, renderStatusLine } from "../src/index.js";
import type { ThinkingEffort } from "../src/types.js";

// =============================================================================
// Shared mutable state — accumulated during the session
// =============================================================================

interface SessionState {
	lastSkill: string | null;
	inputTokens: number;
	outputTokens: number;
}

const session: SessionState = {
	lastSkill: null,
	inputTokens: 0,
	outputTokens: 0,
};

// =============================================================================
// Helpers
// =============================================================================

/** Normalize thinking level string to our format. */
function normalizeThinkingLevel(level: string): ThinkingEffort | null {
	if (level === "off") return null;
	if (level === "low" || level === "medium" || level === "high" || level === "max") {
		return level as ThinkingEffort;
	}
	return null;
}

/** Get the current thinking level from the session's branch entries. */
function getCurrentThinkingLevel(ctx: ExtensionContext): ThinkingEffort | null {
	const branch = ctx.sessionManager.getBranch();
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type === "thinking_level_change") {
			return normalizeThinkingLevel(entry.thinkingLevel);
		}
	}
	return null;
}

/**
 * Build and render the status line as a string.
 */
async function buildStatusLine(ctx: ExtensionContext): Promise<string> {
	const modelDisplay = ctx.model?.name ?? ctx.model?.id ?? null;
	const contextUsage = ctx.getContextUsage();
	const contextPct = contextUsage?.percent ?? null;
	const thinkingLevel = getCurrentThinkingLevel(ctx);

	const gathered = await gatherStatusData(ctx.cwd, true);
	const repoName = gathered.repoRoot ? (gathered.repoRoot.split("/").pop() ?? null) : null;

	const transcriptTokens =
		session.inputTokens > 0 || session.outputTokens > 0
			? { inputTokens: session.inputTokens, outputTokens: session.outputTokens }
			: gathered.transcriptTokens;

	return renderStatusLine(
		{ ...gathered, transcriptTokens },
		{
			cwd: ctx.cwd,
			repoName,
			model: modelDisplay,
			contextPct,
			thinkingLevel,
		},
		session.lastSkill,
	);
}

// =============================================================================
// Extension
// =============================================================================

export default function statuslineExtension(pi: ExtensionAPI) {
	// Track Skill tool invocations
	pi.on("tool_execution_start", (event) => {
		if (event.toolName === "Skill" || event.toolName === "skill") {
			const args = event.args as Record<string, unknown> | undefined;
			if (args?.skill && typeof args.skill === "string") {
				session.lastSkill = args.skill;
			}
		}
	});

	// Accumulate token usage from completed turns and update footer
	pi.on("agent_end", async (event, ctx: ExtensionContext) => {
		for (const message of event.messages) {
			if (message.role === "assistant") {
				const msg = message as { usage?: { input: number; output: number } };
				if (msg.usage) {
					session.inputTokens += msg.usage.input;
					session.outputTokens += msg.usage.output;
				}
			}
		}

		// Update footer with new token counts
		try {
			const statusLine = await buildStatusLine(ctx);
			const lines = statusLine.split("\n");
			if (ctx.hasUI) {
				ctx.ui.setFooter(() => ({
					render(_width: number): string[] {
						return lines;
					},
					invalidate() {},
				}));
			} else {
				for (const line of lines) {
					console.log(line);
				}
			}
		} catch {
			// Ignore footer update errors
		}
	});

	// Register /statusline tool
	pi.registerTool({
		name: "statusline",
		label: "Statusline",
		description: "Print the current status line with model, thinking effort, context %, git info, and token counts",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx: ExtensionContext) {
			try {
				const statusLine = await buildStatusLine(ctx);
				return {
					content: [{ type: "text", text: statusLine }],
					details: {},
				};
			} catch (error) {
				return {
					content: [{ type: "text", text: String(error) }],
					isError: true,
					details: {},
				};
			}
		},
	});

	// Render footer on session start
	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		try {
			const statusLine = await buildStatusLine(ctx);
			const lines = statusLine.split("\n");

			if (ctx.hasUI) {
				// Interactive mode: set footer component
				ctx.ui.setFooter(() => ({
					render(_width: number): string[] {
						return lines;
					},
					invalidate() {},
				}));
			} else {
				// RPC/print mode: fall back to console output
				for (const line of lines) {
					console.log(line);
				}
			}
		} catch (error) {
			console.error("[pi-statusline] Failed to render status line:", error);
		}
	});
}
