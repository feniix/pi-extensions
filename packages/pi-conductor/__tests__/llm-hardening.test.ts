import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assessTaskForRepo,
  buildObjectiveDagForRepo,
  cancelTaskRunForRepo,
  createObjectiveForRepo,
  createTaskForRepo,
  getOrCreateRunForRepo,
  recordTaskCompletionForRepo,
  runNextActionForRepo,
  startTaskRunForRepo,
} from "../extensions/conductor.js";
import { addConductorArtifact, readArtifactContentForRepo, writeRun } from "../extensions/storage.js";

describe("LLM hardening follow-ups", () => {
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

  function addWorkerAndAssign(taskId: string) {
    const run = getOrCreateRunForRepo(repoRoot);
    const worker = {
      workerId: "worker-1",
      name: "worker",
      branch: null,
      worktreePath: repoRoot,
      sessionFile: join(repoRoot, "session.jsonl"),
      runtime: { backend: "session_manager" as const, sessionId: null, lastResumedAt: null },
      currentTask: null,
      lifecycle: "idle" as const,
      recoverable: false,
      lastRun: null,
      summary: { text: null, updatedAt: null, stale: false },
      pr: { url: null, number: null, commitSucceeded: false, pushSucceeded: false, prCreationAttempted: false },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(join(repoRoot, "session.jsonl"), "", "utf-8");
    writeRun({
      ...run,
      workers: [worker],
      tasks: run.tasks.map((entry) =>
        entry.taskId === taskId ? { ...entry, assignedWorkerId: worker.workerId, state: "assigned" } : entry,
      ),
    });
    return worker;
  }

  it("run next action executes retry and reconcile recommendations", () => {
    const task = createTaskForRepo(repoRoot, { title: "Retry me", prompt: "Recover from failure" });
    const worker = addWorkerAndAssign(task.taskId);
    const run = getOrCreateRunForRepo(repoRoot);
    writeRun({ ...run, tasks: run.tasks.map((entry) => ({ ...entry, state: "failed" as const })) });

    const retry = runNextActionForRepo(repoRoot);
    expect(retry.executed).toBe(true);
    expect(retry.action?.kind).toBe("retry_task");

    const running = getOrCreateRunForRepo(repoRoot);
    writeRun({
      ...running,
      runs: running.runs.map((entry) => ({ ...entry, leaseExpiresAt: "2000-01-01T00:00:00.000Z" })),
      workers: running.workers.map((entry) => ({ ...entry, workerId: worker.workerId })),
    });
    const reconcile = runNextActionForRepo(repoRoot);
    expect(reconcile.executed).toBe(true);
    expect(reconcile.action?.kind).toBe("reconcile_project");
  });

  it("rejects artifact symlink escapes and classifies binary content", () => {
    const outside = join(tmpdir(), `outside-${Date.now()}.txt`);
    writeFileSync(outside, "secret", "utf-8");
    symlinkSync(outside, join(repoRoot, "escape.txt"));
    writeFileSync(join(repoRoot, "binary.bin"), Buffer.from([0, 1, 2, 3]));
    let run = addConductorArtifact(getOrCreateRunForRepo(repoRoot), {
      artifactId: "artifact-escape",
      type: "note",
      ref: "escape.txt",
      resourceRefs: {},
      producer: { type: "test", id: "test" },
    });
    run = addConductorArtifact(run, {
      artifactId: "artifact-binary",
      type: "note",
      ref: "binary.bin",
      resourceRefs: {},
      producer: { type: "test", id: "test" },
    });
    writeRun(run);

    expect(() => readArtifactContentForRepo(repoRoot, "artifact-escape")).toThrow(/Unsafe artifact ref/);
    expect(readArtifactContentForRepo(repoRoot, "artifact-binary")).toMatchObject({
      content: null,
      diagnostic: "Artifact file appears to be binary",
    });
    rmSync(outside, { force: true });
  });

  it("DAG reports runnable and external dependency metadata", () => {
    const objective = createObjectiveForRepo(repoRoot, { title: "DAG", prompt: "Batch work" });
    const external = createTaskForRepo(repoRoot, { title: "External", prompt: "Other objective" });
    const first = createTaskForRepo(repoRoot, {
      title: "First",
      prompt: "Do first",
      objectiveId: objective.objectiveId,
    });
    const second = createTaskForRepo(repoRoot, {
      title: "Second",
      prompt: "Do second",
      objectiveId: objective.objectiveId,
      dependsOnTaskIds: [first.taskId, external.taskId],
    });

    const dag = buildObjectiveDagForRepo(repoRoot, objective.objectiveId);

    expect(dag.runnableNow).toEqual([first.taskId]);
    expect(dag.externalDependencies).toEqual([{ taskId: second.taskId, dependsOnTaskId: external.taskId }]);
  });

  it("auto-refreshes objective status after cancel and retry transitions", () => {
    const objective = createObjectiveForRepo(repoRoot, { title: "Refresh", prompt: "Track state" });
    const task = createTaskForRepo(repoRoot, {
      title: "Cancel",
      prompt: "Cancel me",
      objectiveId: objective.objectiveId,
    });
    addWorkerAndAssign(task.taskId);
    const started = startTaskRunForRepo(repoRoot, { taskId: task.taskId, workerId: "worker-1" });

    cancelTaskRunForRepo(repoRoot, { runId: started.run.runId, reason: "stop" });
    expect(getOrCreateRunForRepo(repoRoot).objectives[0]?.status).toBe("blocked");

    runNextActionForRepo(repoRoot);
    expect(getOrCreateRunForRepo(repoRoot).objectives[0]?.status).toBe("active");
  });

  it("assessment includes task state, run, test, and PR evidence findings", () => {
    const task = createTaskForRepo(repoRoot, { title: "Assess", prompt: "Review evidence" });

    const assessment = assessTaskForRepo(repoRoot, {
      taskId: task.taskId,
      requireTestEvidence: true,
      requirePrEvidence: true,
    });

    expect(assessment.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["task_not_terminal", "missing_test_result", "missing_pr_evidence"]),
    );
  });

  it("completion still refreshes objective status with richer hooks", () => {
    const objective = createObjectiveForRepo(repoRoot, { title: "Complete", prompt: "Finish" });
    const task = createTaskForRepo(repoRoot, { title: "Done", prompt: "Complete", objectiveId: objective.objectiveId });
    addWorkerAndAssign(task.taskId);
    const started = startTaskRunForRepo(repoRoot, { taskId: task.taskId, workerId: "worker-1" });

    recordTaskCompletionForRepo(repoRoot, {
      taskId: task.taskId,
      runId: started.run.runId,
      status: "succeeded",
      completionSummary: "done",
      artifact: { type: "completion_report", ref: "completion://done" },
    });

    expect(getOrCreateRunForRepo(repoRoot).objectives[0]?.status).toBe("completed");
  });
});
