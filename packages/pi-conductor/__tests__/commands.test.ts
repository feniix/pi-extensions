import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runConductorCommand } from "../extensions/commands.js";
import {
  assignTaskForRepo,
  createGateForRepo,
  getOrCreateRunForRepo,
  resolveGateForRepo,
  startTaskRunForRepo,
} from "../extensions/conductor.js";

describe("runConductorCommand", () => {
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
    if (existsSync(repoDir)) {
      rmSync(repoDir, { recursive: true, force: true });
    }
    if (existsSync(conductorHome)) {
      rmSync(conductorHome, { recursive: true, force: true });
    }
  });

  it("returns status for the current repo", async () => {
    const text = await runConductorCommand(repoDir, "status");
    expect(text).toContain("workers: 0");
  });

  it("documents trusted human gate commands in usage", async () => {
    const text = await runConductorCommand(repoDir, "help");
    expect(text).toContain("/conductor human gates [reason]");
    expect(text).toContain("/conductor human dashboard");
    expect(text).toContain("/conductor human decide gate <gate-id> [reason]");
    expect(text).toContain("conductor_list_gates");
  });

  it("supports resource-shaped worker and task inspection commands", async () => {
    const workerText = await runConductorCommand(repoDir, "create worker backend");
    expect(workerText).toContain("created worker backend");

    const taskText = await runConductorCommand(repoDir, "create task Add-ledger Implement durable tasks");
    expect(taskText).toContain("created task");

    const tasks = await runConductorCommand(repoDir, "get tasks");
    expect(tasks).toContain("Add-ledger");
    expect(tasks).toContain("state=ready");

    const workers = await runConductorCommand(repoDir, "get workers");
    expect(workers).toContain("backend");
  });

  it("shows individual worker, task, and run resources", async () => {
    await runConductorCommand(repoDir, "create worker backend");
    await runConductorCommand(repoDir, "create task Build Implement it");
    const run = getOrCreateRunForRepo(repoDir);
    const worker = run.workers[0];
    const task = run.tasks[0];
    if (!worker || !task) {
      throw new Error("test resources missing");
    }
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId });

    await expect(runConductorCommand(repoDir, `get worker ${worker.name}`)).resolves.toContain(worker.workerId);
    await expect(runConductorCommand(repoDir, `get task ${task.taskId}`)).resolves.toContain("state=running");
    await expect(runConductorCommand(repoDir, `get run ${started.run.runId}`)).resolves.toContain("status=running");
  });

  it("shows resource-shaped run, gate, event, and artifact inspection commands", async () => {
    const project = await runConductorCommand(repoDir, "get project");
    expect(project).toContain("events:");

    const runs = await runConductorCommand(repoDir, "get runs");
    expect(runs).toBe("runs: none");

    const gates = await runConductorCommand(repoDir, "get gates");
    expect(gates).toBe("gates: none");

    const events = await runConductorCommand(repoDir, "get events");
    expect(events).toBe("events: none");

    const artifacts = await runConductorCommand(repoDir, "get artifacts");
    expect(artifacts).toBe("artifacts: none");
  });

  it("shows paginated resource history", async () => {
    await runConductorCommand(repoDir, "create worker backend");
    await runConductorCommand(repoDir, "create task Build Implement it");
    const task = getOrCreateRunForRepo(repoDir).tasks[0];
    if (!task) {
      throw new Error("task missing");
    }

    const text = await runConductorCommand(repoDir, `history task ${task.taskId} --limit 1`);

    expect(text).toContain("hasMore=");
    expect(text).toContain("task.created");
  });

  it("returns helpful errors for missing create inputs", async () => {
    const missingWorker = await runConductorCommand(repoDir, "create worker");
    expect(missingWorker).toContain("error: missing worker name");

    const missingTask = await runConductorCommand(repoDir, "create task");
    expect(missingTask).toContain("error: missing task title or prompt");

    const badCreate = await runConductorCommand(repoDir, "create something");
    expect(badCreate).toContain("error: unknown resource 'something'");
  });

  it("returns usage for unknown /conductor get resources", async () => {
    const response = await runConductorCommand(repoDir, "get not-real");
    expect(response).toContain("error: unknown resource 'not-real'");
    expect(response).toContain("usage:");
  });

  it("previews reconciliation from the reconcile command without persisting", async () => {
    await runConductorCommand(repoDir, "create worker backend");
    const text = await runConductorCommand(repoDir, "reconcile --dry-run");
    expect(text).toContain("previewed project");
    expect(text).toContain("changed=");
  });

  it("requires resource tools for gate-protected worker cleanup", async () => {
    await runConductorCommand(repoDir, "create worker backend");

    const unsupportedMutation = await runConductorCommand(repoDir, "destroy backend");
    expect(unsupportedMutation).toContain("error: unknown subcommand 'destroy'");
    expect(getOrCreateRunForRepo(repoDir).gates).toHaveLength(0);

    const worker = getOrCreateRunForRepo(repoDir).workers[0];
    const gate = worker
      ? createGateForRepo(repoDir, {
          type: "destructive_cleanup",
          resourceRefs: { workerId: worker.workerId },
          requestedDecision: "Approve cleanup",
        })
      : null;
    if (!worker || !gate) {
      throw new Error("worker or gate missing");
    }
    resolveGateForRepo(repoDir, {
      gateId: gate.gateId,
      status: "approved",
      actor: { type: "human", id: "reviewer" },
      resolutionReason: "cleanup approved",
    });

    const { removeWorkerForRepo } = await import("../extensions/conductor.js");
    const removed = removeWorkerForRepo(repoDir, "backend");
    expect(removed.name).toBe("backend");

    const status = await runConductorCommand(repoDir, "status");
    expect(status).toContain("workers: 0");

    const archived = await runConductorCommand(repoDir, "get worker backend");
    expect(archived).toContain(worker.workerId);
    expect(archived).toContain("archived=true");
  });

  it("shows help for unknown subcommands", async () => {
    const text = await runConductorCommand(repoDir, "wat");
    expect(text).toContain("usage:");
  });
});
