import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildResourceTimelineForRepo,
  createGateForRepo,
  createObjectiveForRepo,
  createTaskForRepo,
  recordTaskProgressForRepo,
  resolveGateForRepo,
} from "../extensions/conductor.js";
import { deriveProjectKey } from "../extensions/project-key.js";
import {
  addWorker,
  assignTaskToWorker,
  createWorkerRecord,
  getRunFile,
  readRun,
  startTaskRun,
  writeRun,
} from "../extensions/storage.js";

describe("conductor resource timeline", () => {
  let conductorHome: string;
  const repoRoot = "/tmp/repo";

  beforeEach(() => {
    conductorHome = mkdtempSync(join(tmpdir(), "pi-conductor-home-"));
    process.env.PI_CONDUCTOR_HOME = conductorHome;
  });

  afterEach(() => {
    delete process.env.PI_CONDUCTOR_HOME;
    if (existsSync(conductorHome)) rmSync(conductorHome, { recursive: true, force: true });
  });

  function addAssignedRun(taskId: string): string {
    const projectKey = deriveProjectKey(repoRoot);
    const run = readRun(projectKey);
    if (!run) throw new Error(`missing run file ${getRunFile(projectKey)}`);
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/repo/.worktrees/backend",
      sessionFile: "/tmp/session.jsonl",
    });
    const withWorker = addWorker(run, worker);
    const assigned = assignTaskToWorker(withWorker, taskId, worker.workerId);
    const running = startTaskRun(assigned, {
      runId: "run-1",
      taskId,
      workerId: worker.workerId,
      backend: "native",
      leaseExpiresAt: "2026-04-24T00:00:00.000Z",
    });
    writeRun(running);
    return "run-1";
  }

  it("builds a markdown and structured timeline for a task", () => {
    const objective = createObjectiveForRepo(repoRoot, { title: "Ship timeline", prompt: "Expose history" });
    const task = createTaskForRepo(repoRoot, {
      title: "Trace task",
      prompt: "Summarize history",
      objectiveId: objective.objectiveId,
    });
    const runId = addAssignedRun(task.taskId);
    recordTaskProgressForRepo(repoRoot, {
      taskId: task.taskId,
      runId,
      progress: "Half done",
      artifact: { type: "note", ref: "progress://half" },
    });
    const gate = createGateForRepo(repoRoot, {
      type: "needs_review",
      resourceRefs: { objectiveId: objective.objectiveId, taskId: task.taskId, runId },
      requestedDecision: "Review timeline output",
    });
    resolveGateForRepo(repoRoot, {
      gateId: gate.gateId,
      status: "approved",
      actor: { type: "parent_agent", id: "parent" },
      resolutionReason: "looks good",
    });

    const timeline = buildResourceTimelineForRepo(repoRoot, { taskId: task.taskId, includeArtifacts: true });

    expect(timeline.markdown).toContain("# Conductor Resource Timeline");
    expect(timeline.resourceRefs).toMatchObject({ taskId: task.taskId });
    expect(timeline.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "task.created",
        "objective.task_linked",
        "run.started",
        "run.progress_reported",
        "gate.created",
        "gate.resolved",
      ]),
    );
    expect(timeline.artifacts.map((artifact) => artifact.ref)).toContain("progress://half");
  });

  it("applies limit to newest matching events", () => {
    const task = createTaskForRepo(repoRoot, { title: "Trace task", prompt: "Summarize history" });
    const runId = addAssignedRun(task.taskId);
    recordTaskProgressForRepo(repoRoot, { taskId: task.taskId, runId, progress: "first" });
    recordTaskProgressForRepo(repoRoot, { taskId: task.taskId, runId, progress: "second" });

    const timeline = buildResourceTimelineForRepo(repoRoot, { taskId: task.taskId, limit: 2 });

    expect(timeline.events).toHaveLength(2);
    expect(timeline.events.at(-1)?.payload).toMatchObject({ progress: "second" });
  });
});
