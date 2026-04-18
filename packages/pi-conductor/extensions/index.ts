import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { runConductorCommand } from "./commands.js";
import { createWorkerForRepo, updateWorkerTaskForRepo } from "./conductor.js";
import { deriveProjectKey } from "./project-key.js";
import { createEmptyRun, readRun, writeRun } from "./storage.js";
import { formatRunStatus } from "./status.js";

function findRepoRoot(cwd: string): string | null {
	try {
		return execSync("git rev-parse --show-toplevel", {
			cwd,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch {
		return null;
	}
}

function getStatusText(cwd: string): string {
	const repoRoot = findRepoRoot(cwd);
	if (!repoRoot) {
		return "pi-conductor: not inside a git repository";
	}

	const projectKey = deriveProjectKey(repoRoot);
	const run = readRun(projectKey) ?? createEmptyRun(projectKey, repoRoot);
	if (!existsSync(run.storageDir)) {
		writeRun(run);
	}

	return formatRunStatus(run);
}

export default function conductorExtension(pi: ExtensionAPI) {
	pi.registerCommand("conductor-status", {
		description: "Show the current pi-conductor project status",
		handler: async (_args, ctx) => {
			const text = getStatusText(ctx.cwd);
			if (ctx.hasUI) {
				ctx.ui.notify(text, "info");
			} else {
				console.log(text);
			}
		},
	});

	pi.registerCommand("conductor", {
		description: "Manage pi-conductor workers (status, start)",
		handler: async (args, ctx) => {
			const text = await runConductorCommand(ctx.cwd, args);
			if (ctx.hasUI) {
				ctx.ui.notify(text, "info");
			} else {
				console.log(text);
			}
		},
	});

	pi.registerTool({
		name: "conductor_status",
		label: "Conductor Status",
		description: "Show the current pi-conductor project namespace and worker status",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const text = getStatusText(ctx.cwd);
			return {
				content: [{ type: "text", text }],
				details: {},
			};
		},
	});

	pi.registerTool({
		name: "conductor_start",
		label: "Conductor Start",
		description: "Create a new pi-conductor worker for the current repository",
		parameters: Type.Object({
			name: Type.String({ description: "Worker name" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const worker = await createWorkerForRepo(ctx.cwd, params.name);
			return {
				content: [
					{ type: "text", text: `created worker ${worker.name} [${worker.workerId}] on branch ${worker.branch}` },
				],
				details: { workerId: worker.workerId, branch: worker.branch, worktreePath: worker.worktreePath },
			};
		},
	});

	pi.registerTool({
		name: "conductor_task_update",
		label: "Conductor Task Update",
		description: "Update the current task for a named pi-conductor worker",
		parameters: Type.Object({
			name: Type.String({ description: "Worker name" }),
			task: Type.String({ description: "Task text" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const worker = updateWorkerTaskForRepo(ctx.cwd, params.name, params.task);
			return {
				content: [{ type: "text", text: `updated task for ${worker.name}: ${worker.currentTask}` }],
				details: { workerId: worker.workerId, task: worker.currentTask },
			};
		},
	});
}
