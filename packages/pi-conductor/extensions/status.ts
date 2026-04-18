import { getConductorProjectDir } from "./storage.js";
import type { RunRecord } from "./types.js";

export function formatRunStatus(run: RunRecord): string {
	const lines = [
		`projectKey: ${run.projectKey}`,
		`repoRoot: ${run.repoRoot}`,
		`storageDir: ${getConductorProjectDir(run.projectKey)}`,
		`workers: ${run.workers.length}`,
	];

	for (const worker of run.workers) {
		const summary = worker.summary.text
			? `${worker.summary.stale ? "stale" : "fresh"}: ${worker.summary.text}`
			: "none";
		lines.push(
			`- ${worker.name} [${worker.workerId}] ` +
				`state=${worker.lifecycle} ` +
				`recoverable=${worker.recoverable} ` +
				`task=${worker.currentTask ?? "none"} ` +
				`branch=${worker.branch ?? "none"} ` +
				`session=${worker.sessionFile ?? "none"} ` +
				`pr=${worker.pr.url ?? "none"} ` +
				`commit=${worker.pr.commitSucceeded} ` +
				`push=${worker.pr.pushSucceeded} ` +
				`prAttempted=${worker.pr.prCreationAttempted} ` +
				`summary=${summary}`,
		);
	}

	return lines.join("\n");
}
