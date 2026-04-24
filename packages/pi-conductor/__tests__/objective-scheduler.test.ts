import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createObjectiveForRepo,
  createTaskForRepo,
  getOrCreateRunForRepo,
  scheduleObjectiveForRepo,
} from "../extensions/conductor.js";
import { writeRun } from "../extensions/storage.js";

describe("objective DAG scheduler", () => {
  let conductorHome: string;
  let repoRoot: string;

  beforeEach(() => {
    conductorHome = mkdtempSync(join(tmpdir(), "pi-conductor-home-"));
    repoRoot = mkdtempSync(join(tmpdir(), "pi-conductor-repo-"));
    process.env.PI_CONDUCTOR_HOME = conductorHome;
  });

  afterEach(() => {
    delete process.env.PI_CONDUCTOR_HOME;
    if (existsSync(conductorHome)) rmSync(conductorHome, { recursive: true, force: true });
    if (existsSync(repoRoot)) rmSync(repoRoot, { recursive: true, force: true });
  });

  it("assigns runnable objective tasks to idle workers with a concurrency limit", async () => {
    const objective = createObjectiveForRepo(repoRoot, { title: "Schedule", prompt: "Run ready tasks" });
    const first = createTaskForRepo(repoRoot, {
      title: "First",
      prompt: "Do first",
      objectiveId: objective.objectiveId,
    });
    const second = createTaskForRepo(repoRoot, {
      title: "Second",
      prompt: "Do second",
      objectiveId: objective.objectiveId,
    });
    const run = getOrCreateRunForRepo(repoRoot);
    const now = new Date().toISOString();
    writeFileSync(join(repoRoot, "session-1.jsonl"), "", "utf-8");
    writeFileSync(join(repoRoot, "session-2.jsonl"), "", "utf-8");
    writeRun({
      ...run,
      workers: ["worker-1", "worker-2"].map((workerId, index) => ({
        workerId,
        name: `worker-${index + 1}`,
        branch: null,
        worktreePath: repoRoot,
        sessionFile: join(repoRoot, `session-${index + 1}.jsonl`),
        runtime: { backend: "session_manager", sessionId: null, lastResumedAt: null },
        currentTask: null,
        lifecycle: "idle",
        recoverable: false,
        lastRun: null,
        summary: { text: null, updatedAt: null, stale: false },
        pr: { url: null, number: null, commitSucceeded: false, pushSucceeded: false, prCreationAttempted: false },
        createdAt: now,
        updatedAt: now,
      })),
    });

    const result = await scheduleObjectiveForRepo(repoRoot, { objectiveId: objective.objectiveId, maxConcurrency: 1 });

    expect(result.assigned).toHaveLength(1);
    expect([first.taskId, second.taskId]).toContain(result.assigned[0]?.taskId);
    expect(getOrCreateRunForRepo(repoRoot).tasks.filter((task) => task.state === "assigned")).toHaveLength(1);
  });
});
