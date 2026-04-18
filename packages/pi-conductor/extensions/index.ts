import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { deriveProjectKey } from "./project-key.js";
import { createEmptyRun, getConductorProjectDir, readRun, writeRun } from "./storage.js";

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

	const lines = [
		`projectKey: ${run.projectKey}`,
		`repoRoot: ${run.repoRoot}`,
		`storageDir: ${getConductorProjectDir(projectKey)}`,
		`workers: ${run.workers.length}`,
	];

	for (const worker of run.workers) {
		lines.push(
			`- ${worker.name} [${worker.workerId}] ` +
				`state=${worker.lifecycle} task=${worker.currentTask ?? "none"} ` +
				`branch=${worker.branch ?? "none"}`,
		);
	}

	return lines.join("\n");
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
}
