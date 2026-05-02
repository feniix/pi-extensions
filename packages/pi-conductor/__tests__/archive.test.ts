import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assignTaskForRepo,
  createGateForRepo,
  createTaskForRepo,
  createWorkerForRepo,
  getOrCreateRunForRepo,
  removeWorkerForRepo,
  resolveGateForRepo,
  resolveGateFromTrustedHumanForRepo,
  startTaskRunForRepo,
} from "../extensions/conductor.js";
import { addConductorArtifact, completeTaskRun, writeRun } from "../extensions/storage.js";

describe("conductor archived cleanup and trusted human gate path", () => {
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

  it("keeps archived worker identity for historical refs after cleanup", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Build", prompt: "Do it" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId });
    let run = getOrCreateRunForRepo(repoDir);
    run = addConductorArtifact(run, {
      artifactId: "artifact-worker-log",
      type: "log",
      ref: "worker.log",
      resourceRefs: { workerId: worker.workerId, taskId: task.taskId, runId: started.run.runId },
      producer: { type: "test", id: "test" },
    });
    run = completeTaskRun(run, {
      runId: started.run.runId,
      status: "succeeded",
      completionSummary: "done",
    });
    writeRun(run);
    const gate = createGateForRepo(repoDir, {
      type: "destructive_cleanup",
      resourceRefs: { workerId: worker.workerId },
      requestedDecision: "Approve cleanup",
    });
    resolveGateFromTrustedHumanForRepo(repoDir, {
      gateId: gate.gateId,
      status: "approved",
      humanId: "ui:test-human",
      resolutionReason: "approved",
    });

    removeWorkerForRepo(repoDir, "backend");

    const after = getOrCreateRunForRepo(repoDir);
    expect(after.workers).toHaveLength(0);
    expect(after.archivedWorkers.map((entry) => entry.workerId)).toContain(worker.workerId);
    expect(after.tasks.find((entry) => entry.taskId === task.taskId)?.assignedWorkerId).toBe(worker.workerId);
    expect(after.runs.find((entry) => entry.runId === started.run.runId)?.workerId).toBe(worker.workerId);
    expect(after.artifacts.find((entry) => entry.artifactId === "artifact-worker-log")?.resourceRefs.workerId).toBe(
      worker.workerId,
    );
    expect(after.events.map((event) => event.type)).toContain("worker.archived");
  });

  it("keeps high-risk model approvals blocked while trusted human path can approve", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const gate = createGateForRepo(repoDir, {
      type: "destructive_cleanup",
      resourceRefs: { workerId: worker.workerId },
      requestedDecision: "Approve cleanup",
    });

    expect(() =>
      resolveGateForRepo(repoDir, {
        gateId: gate.gateId,
        status: "approved",
        actor: { type: "parent_agent", id: "parent" },
        resolutionReason: "agent approval",
      }),
    ).toThrow(/human actor is required/i);

    const approved = resolveGateFromTrustedHumanForRepo(repoDir, {
      gateId: gate.gateId,
      status: "approved",
      humanId: "ui:test-human",
      resolutionReason: "human approved cleanup",
    });

    expect(approved.status).toBe("approved");
    expect(approved.resolvedBy).toMatchObject({ type: "human", id: "ui:test-human" });
  });
});
