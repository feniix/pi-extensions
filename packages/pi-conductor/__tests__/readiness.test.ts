import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assignTaskForRepo,
  buildEvidenceBundleForRepo,
  checkReadinessForRepo,
  createGateForRepo,
  createObjectiveForRepo,
  createTaskForRepo,
  createWorkerForRepo,
  getOrCreateRunForRepo,
  recordTaskCompletionForRepo,
  resolveGateForRepo,
  startTaskRunForRepo,
} from "../extensions/conductor.js";
import { setWorkerPrState, writeRun } from "../extensions/storage.js";

describe("conductor readiness and evidence bundles", () => {
  let repoDir: string;
  let conductorHome: string;

  beforeEach(() => {
    repoDir = execSync("mktemp -d", { encoding: "utf-8" }).trim();
    conductorHome = mkdtempSync(join(tmpdir(), "pi-conductor-home-"));
    process.env.PI_CONDUCTOR_HOME = conductorHome;
    execSync("git init -b main", { cwd: repoDir, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: repoDir, stdio: "pipe" });
    execSync("git config user.name 'Test User'", { cwd: repoDir, stdio: "pipe" });
    writeFileSync(join(repoDir, "README.md"), "hello");
    execSync("git add README.md", { cwd: repoDir, stdio: "pipe" });
    execSync("git commit -m 'initial commit'", { cwd: repoDir, stdio: "pipe" });
  });

  afterEach(() => {
    delete process.env.PI_CONDUCTOR_HOME;
    if (existsSync(repoDir)) rmSync(repoDir, { recursive: true, force: true });
    if (existsSync(conductorHome)) rmSync(conductorHome, { recursive: true, force: true });
  });

  async function completedTaskWithEvidence() {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Build", prompt: "Do it" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId });
    recordTaskCompletionForRepo(repoDir, {
      runId: started.run.runId,
      taskId: task.taskId,
      status: "succeeded",
      completionSummary: "done",
      artifact: { type: "completion_report", ref: "completion://done" },
    });
    return { worker, task, run: started.run };
  }

  it("builds an objective-scoped evidence bundle", async () => {
    const objective = createObjectiveForRepo(repoDir, { title: "Ship objective", prompt: "Coordinate work" });
    const task = createTaskForRepo(repoDir, { title: "Build", prompt: "Do it", objectiveId: objective.objectiveId });

    const bundle = buildEvidenceBundleForRepo(repoDir, { objectiveId: objective.objectiveId, purpose: "handoff" });

    expect(bundle.resourceRefs.objectiveId).toBe(objective.objectiveId);
    expect(bundle.objective?.objectiveId).toBe(objective.objectiveId);
    expect(bundle.tasks.map((entry) => entry.taskId)).toEqual([task.taskId]);
  });

  it("builds a task-scoped evidence bundle", async () => {
    const { task, run } = await completedTaskWithEvidence();

    const bundle = buildEvidenceBundleForRepo(repoDir, {
      taskId: task.taskId,
      purpose: "task_review",
      includeEvents: true,
    });

    expect(bundle.resourceRefs.taskId).toBe(task.taskId);
    expect(bundle.tasks.map((entry) => entry.taskId)).toEqual([task.taskId]);
    expect(bundle.runs.map((entry) => entry.runId)).toContain(run.runId);
    expect(bundle.artifacts.map((entry) => entry.type)).toContain("completion_report");
    expect(bundle.events?.length).toBeGreaterThan(0);
  });

  it("persists evidence bundles as artifacts when requested", async () => {
    const { task } = await completedTaskWithEvidence();

    const result = buildEvidenceBundleForRepo(repoDir, {
      taskId: task.taskId,
      purpose: "task_review",
      persistArtifact: true,
    });

    expect(result.persistedArtifact).toMatchObject({ type: "other" });
    expect(getOrCreateRunForRepo(repoDir).events.map((event) => event.type)).toContain("artifact.created");
  });

  it("marks completed tasks ready for review when completion evidence exists", async () => {
    const { task } = await completedTaskWithEvidence();

    const readiness = checkReadinessForRepo(repoDir, { taskId: task.taskId, purpose: "task_review" });

    expect(readiness.status).toBe("ready");
    expect(readiness.blockers).toEqual([]);
  });

  it("blocks task review when completion evidence is missing", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Build", prompt: "Do it" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId });
    recordTaskCompletionForRepo(repoDir, {
      runId: started.run.runId,
      taskId: task.taskId,
      status: "succeeded",
      completionSummary: "done",
    });

    const readiness = checkReadinessForRepo(repoDir, { taskId: task.taskId, purpose: "task_review" });

    expect(readiness.status).toBe("not_ready");
    expect(readiness.blockers.map((blocker) => blocker.code)).toContain("missing_completion_report");
  });

  it("marks workers ready for PR after commit, push, and approved gate", async () => {
    const { worker } = await completedTaskWithEvidence();
    const run = setWorkerPrState(getOrCreateRunForRepo(repoDir), worker.workerId, {
      commitSucceeded: true,
      pushSucceeded: true,
    });
    writeRun(run);
    const gate = createGateForRepo(repoDir, {
      type: "ready_for_pr",
      resourceRefs: { workerId: worker.workerId },
      requestedDecision: "Approve PR",
    });
    resolveGateForRepo(repoDir, {
      gateId: gate.gateId,
      status: "approved",
      actor: { type: "human", id: "reviewer" },
      resolutionReason: "ready",
    });

    const readiness = checkReadinessForRepo(repoDir, { workerName: "backend", purpose: "pr_readiness" });

    expect(readiness.status).toBe("ready");
    expect(readiness.blockers).toEqual([]);
  });
});
