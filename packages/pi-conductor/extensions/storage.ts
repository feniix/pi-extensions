import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { RunRecord, WorkerRecord } from "./types.js";

function getConductorRoot(): string {
	const override = process.env.PI_CONDUCTOR_HOME?.trim();
	if (override) {
		return join(resolve(override), "projects");
	}
	return join(homedir(), ".pi", "agent", "conductor", "projects");
}

export function getConductorProjectDir(projectKey: string): string {
	return join(getConductorRoot(), projectKey);
}

export function getRunFile(projectKey: string): string {
	return join(getConductorProjectDir(projectKey), "run.json");
}

export function ensureDir(path: string): void {
	mkdirSync(path, { recursive: true });
}

export function readRun(projectKey: string): RunRecord | null {
	const path = getRunFile(projectKey);
	if (!existsSync(path)) {
		return null;
	}
	return JSON.parse(readFileSync(path, "utf-8")) as RunRecord;
}

export function writeRun(run: RunRecord): void {
	const path = getRunFile(run.projectKey);
	ensureDir(dirname(path));
	writeFileSync(path, `${JSON.stringify(run, null, 2)}\n`, "utf-8");
}

export function createEmptyRun(projectKey: string, repoRoot: string): RunRecord {
	const now = new Date().toISOString();
	return {
		projectKey,
		repoRoot: resolve(repoRoot),
		storageDir: getConductorProjectDir(projectKey),
		workers: [],
		createdAt: now,
		updatedAt: now,
	};
}

export function createWorkerRecord(input: {
	workerId: string;
	name: string;
	branch: string | null;
	worktreePath: string | null;
	sessionFile: string | null;
}): WorkerRecord {
	const now = new Date().toISOString();
	return {
		workerId: input.workerId,
		name: input.name,
		branch: input.branch,
		worktreePath: input.worktreePath,
		sessionFile: input.sessionFile,
		currentTask: null,
		lifecycle: "idle",
		recoverable: false,
		summary: {
			text: null,
			updatedAt: null,
			stale: false,
		},
		pr: {
			url: null,
			number: null,
			commitSucceeded: false,
			pushSucceeded: false,
			prCreationAttempted: false,
		},
		createdAt: now,
		updatedAt: now,
	};
}

export function addWorker(run: RunRecord, worker: WorkerRecord): RunRecord {
	if (run.workers.some((existing) => existing.name === worker.name)) {
		throw new Error(`Worker named ${worker.name} already exists`);
	}

	return {
		...run,
		workers: [...run.workers, worker],
		updatedAt: new Date().toISOString(),
	};
}

export function setWorkerTask(run: RunRecord, workerId: string, task: string): RunRecord {
	let found = false;
	const workers = run.workers.map((worker) => {
		if (worker.workerId !== workerId) {
			return worker;
		}
		found = true;
		return {
			...worker,
			currentTask: task,
			summary: {
				...worker.summary,
				stale: worker.summary.text !== null ? true : worker.summary.stale,
			},
			updatedAt: new Date().toISOString(),
		};
	});

	if (!found) {
		throw new Error(`Worker ${workerId} not found`);
	}

	return {
		...run,
		workers,
		updatedAt: new Date().toISOString(),
	};
}

export function setWorkerSummary(run: RunRecord, workerId: string, summaryText: string): RunRecord {
	let found = false;
	const now = new Date().toISOString();
	const workers = run.workers.map((worker) => {
		if (worker.workerId !== workerId) {
			return worker;
		}
		found = true;
		return {
			...worker,
			summary: {
				text: summaryText,
				updatedAt: now,
				stale: false,
			},
			updatedAt: now,
		};
	});

	if (!found) {
		throw new Error(`Worker ${workerId} not found`);
	}

	return {
		...run,
		workers,
		updatedAt: now,
	};
}
