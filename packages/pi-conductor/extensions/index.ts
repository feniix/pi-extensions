import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { runConductorCommand } from "./commands.js";
import {
	commitWorkerForRepo,
	createWorkerForRepo,
	createWorkerPrForRepo,
	getOrCreateRunForRepo,
	pushWorkerForRepo,
	reconcileWorkerHealth,
	recoverWorkerForRepo,
	refreshWorkerSummaryForRepo,
	removeWorkerForRepo,
	resumeWorkerForRepo,
	updateWorkerLifecycleForRepo,
	updateWorkerTaskForRepo,
} from "./conductor.js";
import { deriveProjectKey } from "./project-key.js";
import { formatRunStatus } from "./status.js";
import { createEmptyRun, readRun, writeRun } from "./storage.js";

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

	return formatRunStatus(reconcileWorkerHealth(getOrCreateRunForRepo(repoRoot)));
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
		description: "Manage pi-conductor workers and PR preparation",
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

	pi.registerTool({
		name: "conductor_recover",
		label: "Conductor Recover",
		description: "Recover a broken pi-conductor worker with a missing session link",
		parameters: Type.Object({
			name: Type.String({ description: "Worker name" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const worker = await recoverWorkerForRepo(ctx.cwd, params.name);
			return {
				content: [{ type: "text", text: `recovered worker ${worker.name}: session=${worker.sessionFile}` }],
				details: { workerId: worker.workerId, sessionFile: worker.sessionFile },
			};
		},
	});

	pi.registerTool({
		name: "conductor_summary_refresh",
		label: "Conductor Summary Refresh",
		description: "Refresh a named pi-conductor worker summary from its persisted session",
		parameters: Type.Object({
			name: Type.String({ description: "Worker name" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const worker = refreshWorkerSummaryForRepo(ctx.cwd, params.name);
			return {
				content: [{ type: "text", text: `refreshed summary for ${worker.name}: ${worker.summary.text}` }],
				details: { workerId: worker.workerId, summary: worker.summary },
			};
		},
	});

	pi.registerTool({
		name: "conductor_cleanup",
		label: "Conductor Cleanup",
		description: "Remove a named pi-conductor worker and clean up its worktree and session link",
		parameters: Type.Object({
			name: Type.String({ description: "Worker name" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const worker = removeWorkerForRepo(ctx.cwd, params.name);
			return {
				content: [{ type: "text", text: `removed worker ${worker.name} [${worker.workerId}]` }],
				details: { workerId: worker.workerId },
			};
		},
	});

	pi.registerTool({
		name: "conductor_resume",
		label: "Conductor Resume",
		description: "Resume a healthy pi-conductor worker using its persisted worktree and session linkage",
		parameters: Type.Object({
			name: Type.String({ description: "Worker name" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const worker = resumeWorkerForRepo(ctx.cwd, params.name);
			return {
				content: [{ type: "text", text: `resumed worker ${worker.name}: session=${worker.sessionFile}` }],
				details: { workerId: worker.workerId, sessionFile: worker.sessionFile, worktreePath: worker.worktreePath },
			};
		},
	});

	pi.registerTool({
		name: "conductor_lifecycle_update",
		label: "Conductor Lifecycle Update",
		description: "Update a named pi-conductor worker lifecycle state",
		parameters: Type.Object({
			name: Type.String({ description: "Worker name" }),
			lifecycle: Type.Union([
				Type.Literal("idle"),
				Type.Literal("running"),
				Type.Literal("blocked"),
				Type.Literal("ready_for_pr"),
				Type.Literal("done"),
			]),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const worker = updateWorkerLifecycleForRepo(ctx.cwd, params.name, params.lifecycle);
			return {
				content: [{ type: "text", text: `updated worker ${worker.name} state to ${worker.lifecycle}` }],
				details: { workerId: worker.workerId, lifecycle: worker.lifecycle },
			};
		},
	});

	pi.registerTool({
		name: "conductor_commit",
		label: "Conductor Commit",
		description: "Commit all current worker worktree changes with a supplied commit message",
		parameters: Type.Object({
			name: Type.String({ description: "Worker name" }),
			message: Type.String({ description: "Commit message" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const worker = commitWorkerForRepo(ctx.cwd, params.name, params.message);
			return {
				content: [{ type: "text", text: `committed worker ${worker.name}: ${params.message}` }],
				details: { workerId: worker.workerId, commitSucceeded: worker.pr.commitSucceeded },
			};
		},
	});

	pi.registerTool({
		name: "conductor_push",
		label: "Conductor Push",
		description: "Push a worker branch to origin",
		parameters: Type.Object({
			name: Type.String({ description: "Worker name" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const worker = pushWorkerForRepo(ctx.cwd, params.name);
			return {
				content: [{ type: "text", text: `pushed worker ${worker.name} on branch ${worker.branch}` }],
				details: { workerId: worker.workerId, pushSucceeded: worker.pr.pushSucceeded },
			};
		},
	});

	pi.registerTool({
		name: "conductor_pr_create",
		label: "Conductor PR Create",
		description: "Create a GitHub pull request for a worker branch",
		parameters: Type.Object({
			name: Type.String({ description: "Worker name" }),
			title: Type.String({ description: "PR title" }),
			body: Type.Optional(Type.String({ description: "Optional PR body" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const worker = createWorkerPrForRepo(ctx.cwd, params.name, params.title, params.body);
			return {
				content: [{ type: "text", text: `created PR for ${worker.name}: ${worker.pr.url}` }],
				details: { workerId: worker.workerId, pr: worker.pr },
			};
		},
	});
}
