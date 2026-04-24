import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runConductorCommand } from "../extensions/commands.js";
import {
  assignTaskForRepo,
  createGateForRepo,
  createTaskForRepo,
  getOrCreateRunForRepo,
  recordTaskCompletionForRepo,
  resolveGateForRepo,
  startTaskRunForRepo,
} from "../extensions/conductor.js";

describe("PR preparation flow", () => {
  let repoDir: string;
  let bareRemoteDir: string;
  let conductorHome: string;
  let fakeBinDir: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    repoDir = execSync("mktemp -d", { encoding: "utf-8" }).trim();
    bareRemoteDir = execSync("mktemp -d", { encoding: "utf-8" }).trim();
    conductorHome = mkdtempSync(join(tmpdir(), "pi-conductor-home-"));
    fakeBinDir = mkdtempSync(join(tmpdir(), "pi-conductor-bin-"));
    originalPath = process.env.PATH;
    process.env.PI_CONDUCTOR_HOME = conductorHome;
    process.env.PATH = `${fakeBinDir}:${originalPath ?? ""}`;

    execSync("git init -b main", { cwd: repoDir, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: repoDir, stdio: "pipe" });
    execSync("git config user.name 'Test User'", { cwd: repoDir, stdio: "pipe" });
    writeFileSync(join(repoDir, "README.md"), "hello");
    execSync("git add README.md", { cwd: repoDir, stdio: "pipe" });
    execSync("git commit -m 'initial commit'", { cwd: repoDir, stdio: "pipe" });

    execSync("git init --bare", { cwd: bareRemoteDir, stdio: "pipe" });
    execSync(`git remote add origin ${bareRemoteDir}`, { cwd: repoDir, stdio: "pipe" });
    execSync("git push -u origin main", { cwd: repoDir, stdio: "pipe" });
  });

  afterEach(() => {
    delete process.env.PI_CONDUCTOR_HOME;
    process.env.PATH = originalPath;
    for (const dir of [repoDir, bareRemoteDir, conductorHome, fakeBinDir]) {
      if (dir && existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  function writeFakeGhScript(content: string): void {
    const path = join(fakeBinDir, "gh");
    writeFileSync(path, `#!/bin/sh\n${content}\n`, { encoding: "utf-8", mode: 0o755 });
  }

  async function createChangedWorker(): Promise<string> {
    await runConductorCommand(repoDir, "start backend");
    const worker = getOrCreateRunForRepo(repoDir).workers[0];
    if (!worker?.worktreePath) {
      throw new Error("worker worktree missing in test setup");
    }
    writeFileSync(join(worker.worktreePath, "backend.txt"), "backend changes\n", "utf-8");
    return worker.worktreePath;
  }

  function approveWorkerPrGate(): void {
    const worker = getOrCreateRunForRepo(repoDir).workers[0];
    if (!worker) {
      throw new Error("worker missing");
    }
    const gate = createGateForRepo(repoDir, {
      type: "ready_for_pr",
      resourceRefs: { workerId: worker.workerId },
      requestedDecision: "Approve PR creation",
    });
    resolveGateForRepo(repoDir, {
      gateId: gate.gateId,
      status: "approved",
      actor: { type: "human", id: "reviewer" },
      resolutionReason: "ready",
    });
  }

  it("commits worker changes and persists commit state", async () => {
    const worktreePath = await createChangedWorker();
    const text = await runConductorCommand(repoDir, "commit backend feat: add backend worker");
    expect(text).toContain("committed worker backend");

    const run = getOrCreateRunForRepo(repoDir);
    expect(run.workers[0]?.pr.commitSucceeded).toBe(true);
    expect(run.workers[0]?.pr.pushSucceeded).toBe(false);

    const log = execSync("git log -1 --pretty=%s", { cwd: worktreePath, encoding: "utf-8" }).trim();
    expect(log).toBe("feat: add backend worker");
  });

  it("pushes a worker branch and persists push state", async () => {
    await createChangedWorker();
    await runConductorCommand(repoDir, "commit backend feat: add backend worker");
    const text = await runConductorCommand(repoDir, "push backend");
    expect(text).toContain("pushed worker backend");

    const run = getOrCreateRunForRepo(repoDir);
    expect(run.workers[0]?.pr.pushSucceeded).toBe(true);
    const remoteHead = execSync("git ls-remote --heads origin conductor/backend", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();
    expect(remoteHead).toContain("refs/heads/conductor/backend");
  });

  it("requires an approved ready_for_pr gate before creating a pull request", async () => {
    writeFakeGhScript(
      'if [ "$1" = "--version" ]; then echo \'gh version test\'; exit 0; fi\nif [ "$1 $2" = "auth status" ]; then exit 0; fi\necho \'https://github.com/example/repo/pull/123\'',
    );
    await createChangedWorker();
    await runConductorCommand(repoDir, "commit backend feat: add backend worker");
    await runConductorCommand(repoDir, "push backend");

    await expect(runConductorCommand(repoDir, "pr backend Backend worker PR")).rejects.toThrow(/ready_for_pr gate/i);

    const run = getOrCreateRunForRepo(repoDir);
    expect(run.gates[0]).toMatchObject({ type: "ready_for_pr", status: "open" });
    expect(run.workers[0]?.pr.prCreationAttempted).toBe(false);
  });

  it("rejects ready_for_pr approvals scoped to the wrong operation", async () => {
    writeFakeGhScript(
      'if [ "$1" = "--version" ]; then echo \'gh version test\'; exit 0; fi\nif [ "$1 $2" = "auth status" ]; then exit 0; fi\necho \'https://github.com/example/repo/pull/123\'',
    );
    await createChangedWorker();
    await runConductorCommand(repoDir, "commit backend feat: add backend worker");
    await runConductorCommand(repoDir, "push backend");
    const worker = getOrCreateRunForRepo(repoDir).workers[0];
    if (!worker) throw new Error("worker missing");
    const gate = createGateForRepo(repoDir, {
      type: "ready_for_pr",
      resourceRefs: { workerId: worker.workerId },
      requestedDecision: "Approve the wrong thing",
      operation: "destructive_cleanup",
    });
    resolveGateForRepo(repoDir, {
      gateId: gate.gateId,
      status: "approved",
      actor: { type: "human", id: "reviewer" },
      resolutionReason: "ready",
    });

    await expect(runConductorCommand(repoDir, "pr backend Backend worker PR")).rejects.toThrow(/create_worker_pr/i);
  });

  it("creates a pull request and persists PR metadata", async () => {
    writeFakeGhScript(
      'if [ "$1" = "--version" ]; then echo \'gh version test\'; exit 0; fi\nif [ "$1 $2" = "auth status" ]; then exit 0; fi\necho \'https://github.com/example/repo/pull/123\'',
    );
    await createChangedWorker();
    await runConductorCommand(repoDir, "commit backend feat: add backend worker");
    await runConductorCommand(repoDir, "push backend");
    approveWorkerPrGate();
    const text = await runConductorCommand(repoDir, "pr backend Backend worker PR");
    expect(text).toContain("created PR for backend");
    expect(text).toContain("pull/123");

    const run = getOrCreateRunForRepo(repoDir);
    expect(run.workers[0]?.pr.prCreationAttempted).toBe(true);
    expect(run.workers[0]?.pr.number).toBe(123);
    expect(run.workers[0]?.pr.url).toContain("pull/123");
    expect(run.artifacts[0]).toMatchObject({ type: "pr_evidence", ref: "https://github.com/example/repo/pull/123" });
    expect(run.events.map((event) => event.type)).toContain("artifact.created");
    const gate = run.gates.find((entry) => entry.type === "ready_for_pr");
    expect(gate?.usedAt).toBeTruthy();
  });

  it("does not reuse consumed ready_for_pr approvals", async () => {
    writeFakeGhScript(
      'if [ "$1" = "--version" ]; then echo \'gh version test\'; exit 0; fi\nif [ "$1 $2" = "auth status" ]; then exit 0; fi\necho \'https://github.com/example/repo/pull/123\'',
    );
    await createChangedWorker();
    await runConductorCommand(repoDir, "commit backend feat: add backend worker");
    await runConductorCommand(repoDir, "push backend");
    approveWorkerPrGate();
    await runConductorCommand(repoDir, "pr backend Backend worker PR");

    await expect(runConductorCommand(repoDir, "pr backend Backend worker PR Again")).rejects.toThrow(
      /fresh ready_for_pr gate/i,
    );
  });

  it("links PR evidence to completed worker tasks", async () => {
    writeFakeGhScript(
      'if [ "$1" = "--version" ]; then echo \'gh version test\'; exit 0; fi\nif [ "$1 $2" = "auth status" ]; then exit 0; fi\necho \'https://github.com/example/repo/pull/123\'',
    );
    await createChangedWorker();
    const worker = getOrCreateRunForRepo(repoDir).workers[0];
    if (!worker) {
      throw new Error("worker missing");
    }
    const task = createTaskForRepo(repoDir, { title: "Backend task", prompt: "Implement backend changes" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId });
    recordTaskCompletionForRepo(repoDir, {
      runId: started.run.runId,
      taskId: task.taskId,
      status: "succeeded",
      completionSummary: "Backend task complete",
    });
    await runConductorCommand(repoDir, "commit backend feat: add backend worker");
    await runConductorCommand(repoDir, "push backend");
    approveWorkerPrGate();

    await runConductorCommand(repoDir, "pr backend Backend worker PR");

    const run = getOrCreateRunForRepo(repoDir);
    expect(run.artifacts[0]?.resourceRefs.taskId).toBe(task.taskId);
    expect(run.artifacts[0]?.resourceRefs.runId).toBe(started.run.runId);
    expect(run.artifacts[0]?.metadata).toMatchObject({ taskIds: [task.taskId], runIds: [started.run.runId] });
  });

  it("persists partial PR state when gh pr create fails", async () => {
    writeFakeGhScript(
      'if [ "$1" = "--version" ]; then echo \'gh version test\'; exit 0; fi\nif [ "$1 $2" = "auth status" ]; then exit 0; fi\necho \'gh pr create failed\' >&2\nexit 1',
    );
    await createChangedWorker();
    await runConductorCommand(repoDir, "commit backend feat: add backend worker");
    await runConductorCommand(repoDir, "push backend");
    approveWorkerPrGate();

    await expect(runConductorCommand(repoDir, "pr backend Backend worker PR")).rejects.toThrow();

    const run = getOrCreateRunForRepo(repoDir);
    expect(run.workers[0]?.pr.commitSucceeded).toBe(true);
    expect(run.workers[0]?.pr.pushSucceeded).toBe(true);
    expect(run.workers[0]?.pr.prCreationAttempted).toBe(true);
    expect(run.workers[0]?.pr.url).toBeNull();
  });

  it("reports a preflight error when gh is not installed", async () => {
    writeFakeGhScript("exit 127");
    process.env.PATH = `${fakeBinDir}:${originalPath ?? ""}`;
    await createChangedWorker();
    await runConductorCommand(repoDir, "commit backend feat: add backend worker");
    await runConductorCommand(repoDir, "push backend");
    approveWorkerPrGate();

    await expect(runConductorCommand(repoDir, "pr backend Backend worker PR")).rejects.toThrow(/GitHub CLI/i);

    const run = getOrCreateRunForRepo(repoDir);
    expect(run.workers[0]?.pr.commitSucceeded).toBe(true);
    expect(run.workers[0]?.pr.pushSucceeded).toBe(true);
    expect(run.workers[0]?.pr.prCreationAttempted).toBe(false);
  });

  it("reports a preflight error when gh is not authenticated", async () => {
    writeFakeGhScript(
      'if [ "$1" = "--version" ]; then echo \'gh version test\'; exit 0; fi\nif [ "$1 $2" = "auth status" ]; then echo \'not authenticated\' >&2; exit 1; fi\necho \'unexpected call\' >&2\nexit 1',
    );
    await createChangedWorker();
    await runConductorCommand(repoDir, "commit backend feat: add backend worker");
    await runConductorCommand(repoDir, "push backend");
    approveWorkerPrGate();

    await expect(runConductorCommand(repoDir, "pr backend Backend worker PR")).rejects.toThrow(/authenticated/i);

    const run = getOrCreateRunForRepo(repoDir);
    expect(run.workers[0]?.pr.commitSucceeded).toBe(true);
    expect(run.workers[0]?.pr.pushSucceeded).toBe(true);
    expect(run.workers[0]?.pr.prCreationAttempted).toBe(false);
  });
});
