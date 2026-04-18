import { resolve } from "node:path";
import { deriveProjectKey } from "./project-key.js";
import { addWorker, createEmptyRun, createWorkerRecord, readRun, setWorkerTask, writeRun } from "./storage.js";
import type { RunRecord, WorkerRecord } from "./types.js";
import { createManagedWorktree } from "./worktrees.js";
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

export function createWorkerForRepo(repoRoot: string, workerName: string): WorkerRecord {
	const run = getOrCreateRunForRepo(repoRoot);
	const workerId = createWorkerId();
	const worktree = createManagedWorktree(run.repoRoot, {
		workerId,
		workerName,
	});
	const worker = createWorkerRecord({
		workerId,
		name: workerName,
		branch: worktree.branch,
		worktreePath: worktree.worktreePath,
		sessionFile: null,
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
