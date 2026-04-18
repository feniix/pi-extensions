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
import { formatRunStatus } from "./status.js";

function getUsage(): string {
	return [
		"usage:",
		"  /conductor status",
		"  /conductor start <worker-name>",
		"  /conductor task <worker-name> <task>",
		"  /conductor resume <worker-name>",
		"  /conductor state <worker-name> <lifecycle>",
		"  /conductor recover <worker-name>",
		"  /conductor summarize <worker-name>",
		"  /conductor cleanup <worker-name>",
		"  /conductor commit <worker-name> <message>",
		"  /conductor push <worker-name>",
		"  /conductor pr <worker-name> <title>",
	].join("\n");
}

type CommandHandler = (rest: string[]) => Promise<string>;

function parseCommand(args: string): { subcommand: string | null; rest: string[] } {
	const trimmed = args.trim();
	if (!trimmed || trimmed === "help") {
		return { subcommand: null, rest: [] };
	}
	const [subcommand, ...rest] = trimmed.split(/\s+/);
	return { subcommand, rest };
}

function requireSingleName(rest: string[], usage: string): string {
	const workerName = rest.join(" ").trim();
	if (!workerName) {
		throw new Error(`${usage}\n\nerror: missing worker name`);
	}
	return workerName;
}

function createHandlers(cwd: string, usage: string): Record<string, CommandHandler> {
	return {
		status: async () => formatRunStatus(reconcileWorkerHealth(getOrCreateRunForRepo(cwd))),
		start: async (rest) => {
			const workerName = requireSingleName(rest, usage);
			const worker = await createWorkerForRepo(cwd, workerName);
			return `created worker ${worker.name} [${worker.workerId}] on branch ${worker.branch}`;
		},
		task: async (rest) => {
			const [workerName, ...taskParts] = rest;
			const task = taskParts.join(" ").trim();
			if (!workerName || !task) {
				throw new Error(`${usage}\n\nerror: missing worker name or task`);
			}
			const worker = updateWorkerTaskForRepo(cwd, workerName, task);
			return `updated task for ${worker.name}: ${worker.currentTask}`;
		},
		resume: async (rest) => {
			const workerName = requireSingleName(rest, usage);
			const worker = resumeWorkerForRepo(cwd, workerName);
			return `resumed worker ${worker.name}: session=${worker.sessionFile}`;
		},
		state: async (rest) => {
			const [workerName, lifecycle] = rest;
			if (!workerName || !lifecycle) {
				throw new Error(`${usage}\n\nerror: missing worker name or lifecycle state`);
			}
			const worker = updateWorkerLifecycleForRepo(cwd, workerName, lifecycle as never);
			return `updated worker ${worker.name} state to ${worker.lifecycle}`;
		},
		recover: async (rest) => {
			const workerName = requireSingleName(rest, usage);
			const worker = await recoverWorkerForRepo(cwd, workerName);
			return `recovered worker ${worker.name}: session=${worker.sessionFile}`;
		},
		summarize: async (rest) => {
			const workerName = requireSingleName(rest, usage);
			const worker = refreshWorkerSummaryForRepo(cwd, workerName);
			return `refreshed summary for ${worker.name}: ${worker.summary.text}`;
		},
		cleanup: async (rest) => {
			const workerName = requireSingleName(rest, usage);
			const worker = removeWorkerForRepo(cwd, workerName);
			return `removed worker ${worker.name} [${worker.workerId}]`;
		},
		commit: async (rest) => {
			const [workerName, ...messageParts] = rest;
			const message = messageParts.join(" ").trim();
			if (!workerName || !message) {
				throw new Error(`${usage}\n\nerror: missing worker name or commit message`);
			}
			const worker = commitWorkerForRepo(cwd, workerName, message);
			return `committed worker ${worker.name}: ${message}`;
		},
		push: async (rest) => {
			const workerName = requireSingleName(rest, usage);
			const worker = pushWorkerForRepo(cwd, workerName);
			return `pushed worker ${worker.name} on branch ${worker.branch}`;
		},
		pr: async (rest) => {
			const [workerName, ...titleParts] = rest;
			const title = titleParts.join(" ").trim();
			if (!workerName || !title) {
				throw new Error(`${usage}\n\nerror: missing worker name or PR title`);
			}
			const worker = createWorkerPrForRepo(cwd, workerName, title);
			return `created PR for ${worker.name}: ${worker.pr.url}`;
		},
	};
}

export async function runConductorCommand(cwd: string, args: string): Promise<string> {
	const usage = getUsage();
	const { subcommand, rest } = parseCommand(args);
	if (!subcommand) {
		return usage;
	}
	const handler = createHandlers(cwd, usage)[subcommand];
	if (!handler) {
		return `${usage}\n\nerror: unknown subcommand '${subcommand}'`;
	}
	return handler(rest);
}
