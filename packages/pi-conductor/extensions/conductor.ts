import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { deriveProjectKey } from "./project-key.js";
import { addWorker, createEmptyRun, createWorkerRecord, readRun, setWorkerSummary, setWorkerTask, writeRun } from "./storage.js";
import type { RunRecord, WorkerRecord } from "./types.js";
import { createManagedWorktree, recreateManagedWorktree } from "./worktrees.js";
import { createWorkerSessionLink } from "./sessions.js";
import { generateWorkerSummaryFromSession } from "./summaries.js";
import { createWorkerId } from "./workers.js";

export function getOrCreateRunForRepo(repoRoot: string): RunRecord {
	const normalizedRoot = resolve(repoRoot);
	const projectKey = deriveProjectKey(normalizedRoot);
	const existing = readRun(projectKey);
	if (existing) {
		return existing;
	}
	const run = createEmptyRun(projectKey, normalizedRoot);
	writeRun(run);
	return run;
}

export async function createWorkerForRepo(repoRoot: string, workerName: string): Promise<WorkerRecord> {
	const run = getOrCreateRunForRepo(repoRoot);
	const workerId = createWorkerId();
	const worktree = createManagedWorktree(run.repoRoot, {
		workerId,
		workerName,
	});
	const sessionFile = await createWorkerSessionLink(worktree.worktreePath);
	const worker = createWorkerRecord({
		workerId,
		name: workerName,
		branch: worktree.branch,
		worktreePath: worktree.worktreePath,
		sessionFile,
	});
	const updatedRun = addWorker(run, worker);
	writeRun(updatedRun);
	return worker;
}

export function updateWorkerTaskForRepo(repoRoot: string, workerName: string, task: string): WorkerRecord {
	const run = getOrCreateRunForRepo(repoRoot);
	const worker = run.workers.find((entry) => entry.name === workerName);
	if (!worker) {
		throw new Error(`Worker named ${workerName} not found`);
	}
	const updatedRun = setWorkerTask(run, worker.workerId, task);
	writeRun(updatedRun);
	const updatedWorker = updatedRun.workers.find((entry) => entry.workerId === worker.workerId);
	if (!updatedWorker) {
		throw new Error(`Worker named ${workerName} disappeared during task update`);
	}
	return updatedWorker;
}

export function reconcileWorkerHealth(run: RunRecord): RunRecord {
	const workers = run.workers.map((worker) => {
		const worktreeMissing = !worker.worktreePath || !existsSync(worker.worktreePath);
		const sessionMissing = !worker.sessionFile || !existsSync(worker.sessionFile);
		if (!worktreeMissing && !sessionMissing) {
			return worker;
		}
		return {
			...worker,
			lifecycle: "broken" as const,
			recoverable: true,
			updatedAt: new Date().toISOString(),
		};
	});
	return {
		...run,
		workers,
		updatedAt: new Date().toISOString(),
	};
}

export function refreshWorkerSummaryForRepo(repoRoot: string, workerName: string): WorkerRecord {
	const run = getOrCreateRunForRepo(repoRoot);
	const worker = run.workers.find((entry) => entry.name === workerName);
	if (!worker) {
		throw new Error(`Worker named ${workerName} not found`);
	}
	if (!worker.sessionFile || !existsSync(worker.sessionFile)) {
		throw new Error(`Worker named ${workerName} does not have a valid session file`);
	}
	const summaryText = generateWorkerSummaryFromSession(worker.sessionFile);
	const updatedRun = setWorkerSummary(run, worker.workerId, summaryText);
	writeRun(updatedRun);
	const updatedWorker = updatedRun.workers.find((entry) => entry.workerId === worker.workerId);
	if (!updatedWorker) {
		throw new Error(`Worker named ${workerName} disappeared during summary refresh`);
	}
	return updatedWorker;
}

export async function recoverWorkerForRepo(repoRoot: string, workerName: string): Promise<WorkerRecord> {
	const run = getOrCreateRunForRepo(repoRoot);
	const worker = run.workers.find((entry) => entry.name === workerName);
	if (!worker) {
		throw new Error(`Worker named ${workerName} not found`);
	}

	let worktreePath = worker.worktreePath;
	if (!worktreePath || !existsSync(worktreePath)) {
		if (!worker.branch) {
			throw new Error(`Worker named ${workerName} cannot be recovered without a valid branch`);
		}
		worktreePath = recreateManagedWorktree(run.repoRoot, {
			workerName: worker.name,
			branch: worker.branch,
		}).worktreePath;
	}

	let sessionFile = worker.sessionFile;
	if (!sessionFile || !existsSync(sessionFile)) {
		sessionFile = await createWorkerSessionLink(worktreePath);
	}

	const workers = run.workers.map((entry) =>
		entry.workerId === worker.workerId
			? {
				...entry,
				worktreePath,
				sessionFile,
				lifecycle: "idle" as const,
				recoverable: false,
				updatedAt: new Date().toISOString(),
			}
			: entry,
	);
	const updatedRun = {
		...run,
		workers,
		updatedAt: new Date().toISOString(),
	};
	writeRun(updatedRun);
	const updatedWorker = updatedRun.workers.find((entry) => entry.workerId === worker.workerId);
	if (!updatedWorker) {
		throw new Error(`Worker named ${workerName} disappeared during recovery`);
	}
	return updatedWorker;
}
