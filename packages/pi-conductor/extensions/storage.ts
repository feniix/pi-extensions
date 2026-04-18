import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { RunRecord } from "./types.js";

const CONDUCTOR_ROOT = join(homedir(), ".pi", "agent", "conductor", "projects");

export function getConductorProjectDir(projectKey: string): string {
	return join(CONDUCTOR_ROOT, projectKey);
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
