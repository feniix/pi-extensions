export type WorkerLifecycleState = "idle" | "running" | "blocked" | "ready_for_pr" | "done" | "broken";

export interface WorkerSummary {
	text: string | null;
	updatedAt: string | null;
	stale: boolean;
}

export interface WorkerPrState {
	url: string | null;
	number: number | null;
	commitSucceeded: boolean;
	pushSucceeded: boolean;
	prCreationAttempted: boolean;
}

export interface WorkerRecord {
	workerId: string;
	name: string;
	branch: string | null;
	worktreePath: string | null;
	sessionFile: string | null;
	currentTask: string | null;
	lifecycle: WorkerLifecycleState;
	recoverable: boolean;
	summary: WorkerSummary;
	pr: WorkerPrState;
	createdAt: string;
	updatedAt: string;
}

export interface RunRecord {
	projectKey: string;
	repoRoot: string;
	storageDir: string;
	workers: WorkerRecord[];
	createdAt: string;
	updatedAt: string;
}
