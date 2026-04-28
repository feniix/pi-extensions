import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assignTaskForRepo,
  cancelTaskRunForRepo,
  createTaskForRepo,
  createWorkerForRepo,
  getOrCreateRunForRepo,
  startTaskRunForRepo,
} from "../extensions/conductor.js";
import { deriveProjectKey } from "../extensions/project-key.js";
import {
  createRunnerContract,
  finalizeRunnerExitForRepo,
  parseRunnerArgs,
  readRunnerContract,
  runRunnerFromContract,
  validateRunnerContractForRepo,
  writeRunnerContract,
} from "../extensions/runner.js";
import { getRunLockFile, writeRun } from "../extensions/storage.js";

describe("pi-conductor runner contract", () => {
  let repoDir: string;
  let conductorHome: string;

  beforeEach(() => {
    repoDir = execSync("mktemp -d", { encoding: "utf-8" }).trim();
    conductorHome = mkdtempSync(join(tmpdir(), "pi-conductor-home-"));
    process.env.PI_CONDUCTOR_HOME = conductorHome;
    execSync("git init -b main", { cwd: repoDir, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: repoDir, stdio: "pipe" });
    execSync("git config user.name 'Test User'", { cwd: repoDir, stdio: "pipe" });
    writeFileSync(join(repoDir, "README.md"), "hello\n");
    execSync("git add README.md", { cwd: repoDir, stdio: "pipe" });
    execSync("git commit -m 'initial commit'", { cwd: repoDir, stdio: "pipe" });
  });

  afterEach(() => {
    delete process.env.PI_CONDUCTOR_HOME;
    for (const dir of [repoDir, conductorHome]) {
      if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  });

  async function createStartedContract(nonce = "nonce-1", options: { persistRuntimeMetadata?: boolean } = {}) {
    const worker = await createWorkerForRepo(repoDir, `runner-worker-${nonce.replace(/[^a-zA-Z0-9_-]/g, "-")}`);
    const task = createTaskForRepo(repoDir, { title: "Runner task", prompt: "Run through contract" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId });
    const contract = createRunnerContract({
      repoRoot: repoDir,
      worktreePath: worker.worktreePath ?? repoDir,
      sessionFile: worker.sessionFile ?? join(repoDir, "session.jsonl"),
      taskContract: started.taskContract,
      nonce,
      createdAt: "2026-04-27T00:00:00.000Z",
    });
    const contractPath = join(conductorHome, `${started.run.runId}-contract.json`);
    writeRunnerContract(contractPath, contract);
    if (options.persistRuntimeMetadata ?? true) {
      const expectedHash = createHash("sha256").update(nonce).digest("hex");
      const run = getOrCreateRunForRepo(repoDir);
      writeRun({
        ...run,
        runs: run.runs.map((entry) =>
          entry.runId === started.run.runId
            ? { ...entry, runtime: { ...entry.runtime, contractPath, nonceHash: expectedHash } }
            : entry,
        ),
      });
    }
    return { worker, task, started, contract, contractPath, nonce };
  }

  it("rejects external runner contracts before durable nonce metadata is recorded", async () => {
    const { contractPath, nonce } = await createStartedContract("nonce-1", { persistRuntimeMetadata: false });

    await expect(
      runRunnerFromContract({
        contractPath,
        nonce,
        async runWorker() {
          throw new Error("should not run");
        },
      }),
    ).rejects.toThrow(/Runner contract nonce metadata is not recorded/i);
  });

  it("reads and removes runner nonces from nonce files", async () => {
    const noncePath = join(conductorHome, "runner.nonce");
    writeFileSync(noncePath, "nonce-from-file\n", "utf-8");

    const parsed = parseRunnerArgs(["run", "--contract", "/tmp/contract.json", "--nonce-file", noncePath]);

    expect(parsed).toEqual({ contractPath: "/tmp/contract.json", nonce: "nonce-from-file" });
    expect(existsSync(noncePath)).toBe(false);
  });

  it("rejects malformed runner contract files with clear validation errors", async () => {
    const contractPath = join(conductorHome, "malformed-contract.json");
    writeFileSync(
      contractPath,
      JSON.stringify({
        schemaVersion: 1,
        repoRoot: 42,
        worktreePath: repoDir,
        sessionFile: join(repoDir, ".pi-session.jsonl"),
        taskContract: {
          taskId: "task-1",
          runId: "run-1",
          taskRevision: 1,
          goal: "Do it",
          explicitCompletionTools: true,
        },
        nonceHash: createHash("sha256").update("nonce").digest("hex"),
        createdAt: "2026-04-27T00:00:00.000Z",
        heartbeatIntervalMs: 5000,
      }),
      "utf-8",
    );

    expect(() => readRunnerContract(contractPath)).toThrow(/Runner contract repoRoot must be a string/i);
  });

  it("forwards runner progress and completion through scoped conductor mutations", async () => {
    const { task, started, contractPath, nonce } = await createStartedContract();

    await runRunnerFromContract({
      contractPath,
      nonce,
      async runWorker(input) {
        await input.onConductorProgress?.({
          runId: started.run.runId,
          taskId: task.taskId,
          progress: "halfway",
          artifact: { type: "log", ref: "log://halfway" },
        });
        await input.onConductorComplete?.({
          runId: started.run.runId,
          taskId: task.taskId,
          status: "succeeded",
          completionSummary: "done from runner",
          artifact: { type: "completion_report", ref: "completion://done" },
        });
        return { status: "success", finalText: "done", errorMessage: null, sessionId: "runner-session" };
      },
    });

    const persisted = getOrCreateRunForRepo(repoDir);
    expect(persisted.tasks[0]).toMatchObject({ state: "completed", latestProgress: "halfway", activeRunId: null });
    expect(persisted.runs[0]).toMatchObject({ status: "succeeded", completionSummary: "done from runner" });
    expect(persisted.artifacts.map((artifact) => artifact.type)).toEqual(["log", "completion_report"]);
  });

  it("retries runner-originated writes while the conductor state lock is briefly held", async () => {
    const { task, started, contractPath, nonce } = await createStartedContract();
    const lockPath = getRunLockFile(deriveProjectKey(resolve(repoDir)));

    await runRunnerFromContract({
      contractPath,
      nonce,
      async runWorker(input) {
        writeFileSync(lockPath, JSON.stringify({ pid: 123, createdAt: new Date().toISOString() }));
        setTimeout(() => unlinkSync(lockPath), 25);
        await input.onConductorComplete?.({
          runId: started.run.runId,
          taskId: task.taskId,
          status: "succeeded",
          completionSummary: "completed after retry",
          idempotencyKey: "complete-after-lock",
        });
        return { status: "success", finalText: "done", errorMessage: null, sessionId: "runner-session" };
      },
    });

    expect(getOrCreateRunForRepo(repoDir).runs[0]).toMatchObject({
      status: "succeeded",
      completionSummary: "completed after retry",
    });
  });

  it("uses the persisted contract heartbeat interval for CLI runner invocations", async () => {
    const { task, started, contractPath, nonce, contract } = await createStartedContract();
    writeRunnerContract(contractPath, { ...contract, heartbeatIntervalMs: 5 });

    await runRunnerFromContract({
      contractPath,
      nonce,
      async runWorker(input) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        await input.onConductorComplete?.({
          runId: started.run.runId,
          taskId: task.taskId,
          status: "succeeded",
          completionSummary: "done after persisted heartbeat",
        });
        return { status: "success", finalText: "done", errorMessage: null, sessionId: "runner-session" };
      },
    });

    expect(getOrCreateRunForRepo(repoDir).events.map((event) => event.type)).toContain("run.heartbeat");
  });

  it("emits runner heartbeats while work is still active", async () => {
    const { task, started, contractPath, nonce } = await createStartedContract();

    await runRunnerFromContract({
      contractPath,
      nonce,
      heartbeatIntervalMs: 5,
      async runWorker(input) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        await input.onConductorComplete?.({
          runId: started.run.runId,
          taskId: task.taskId,
          status: "succeeded",
          completionSummary: "done after heartbeat",
        });
        return { status: "success", finalText: "done", errorMessage: null, sessionId: "runner-session" };
      },
    });

    const persisted = getOrCreateRunForRepo(repoDir);
    expect(persisted.events.map((event) => event.type)).toContain("run.heartbeat");
    expect(persisted.runs[0]?.lastHeartbeatAt).toBeTruthy();
    expect(persisted.runs[0]?.runtime.heartbeatAt).toBeTruthy();
  });

  it("preserves blocked outcomes reported through the runner contract", async () => {
    const { task, started, contractPath, nonce } = await createStartedContract();

    await runRunnerFromContract({
      contractPath,
      nonce,
      async runWorker(input) {
        await input.onConductorComplete?.({
          runId: started.run.runId,
          taskId: task.taskId,
          status: "blocked",
          completionSummary: "needs human input",
        });
        return { status: "success", finalText: "needs human input", errorMessage: null, sessionId: "runner-session" };
      },
    });

    const persisted = getOrCreateRunForRepo(repoDir);
    expect(persisted.tasks[0]).toMatchObject({ state: "blocked", activeRunId: null });
    expect(persisted.runs[0]).toMatchObject({ status: "blocked", completionSummary: "needs human input" });
  });

  it("marks the run failed when the runner crashes before completion", async () => {
    const { contractPath, nonce } = await createStartedContract();

    await expect(
      runRunnerFromContract({
        contractPath,
        nonce,
        async runWorker() {
          throw new Error("runner crashed");
        },
      }),
    ).rejects.toThrow(/runner crashed/i);

    const persisted = getOrCreateRunForRepo(repoDir);
    expect(persisted.tasks[0]).toMatchObject({ state: "failed", activeRunId: null });
    expect(persisted.runs[0]).toMatchObject({ status: "failed", completionSummary: "runner crashed" });
  });

  it("releases tmux workers after fallback completion on runner exit", async () => {
    const { started, contractPath, nonce } = await createStartedContract("tmux-fallback-nonce");
    const expectedHash = createHash("sha256").update(nonce).digest("hex");
    const run = getOrCreateRunForRepo(repoDir);
    writeRun({
      ...run,
      runs: run.runs.map((entry) =>
        entry.runId === started.run.runId
          ? { ...entry, runtime: { ...entry.runtime, mode: "tmux", contractPath, nonceHash: expectedHash } }
          : entry,
      ),
    });

    await runRunnerFromContract({
      contractPath,
      nonce,
      async runWorker() {
        return { status: "success", finalText: "tmux runner exited", errorMessage: null, sessionId: "tmux-session" };
      },
    });

    const persisted = getOrCreateRunForRepo(repoDir);
    expect(persisted.runs[0]).toMatchObject({ status: "partial" });
    expect(persisted.workers[0]).toMatchObject({ lifecycle: "idle", recoverable: false });
  });

  it("does not release a worker from stale tmux finalization when a newer run is active", async () => {
    const { worker, task, started, contract } = await createStartedContract("old-tmux-finalizer-nonce");
    cancelTaskRunForRepo(repoDir, { runId: started.run.runId, reason: "superseded" });
    const latest = getOrCreateRunForRepo(repoDir);
    const newerTask = {
      ...task,
      taskId: "task-newer-finalizer",
      activeRunId: "run-newer-finalizer",
      runIds: ["run-newer-finalizer"],
    };
    const newerRun = {
      ...started.run,
      runId: "run-newer-finalizer",
      taskId: "task-newer-finalizer",
      status: "running" as const,
      finishedAt: null,
    };
    writeRun({
      ...latest,
      tasks: [...latest.tasks, newerTask],
      runs: [...latest.runs, newerRun],
      workers: latest.workers.map((entry) =>
        entry.workerId === worker.workerId ? { ...entry, lifecycle: "running" as const, recoverable: false } : entry,
      ),
    });

    finalizeRunnerExitForRepo({
      repoRoot: repoDir,
      contract,
      result: { status: "success", finalText: "old exit", errorMessage: null, sessionId: "old-session" },
    });

    expect(getOrCreateRunForRepo(repoDir).workers[0]).toMatchObject({ lifecycle: "running", recoverable: false });
  });

  it("creates a needs-review fallback when the runner exits without explicit completion", async () => {
    const { contractPath, nonce } = await createStartedContract();

    await runRunnerFromContract({
      contractPath,
      nonce,
      async runWorker() {
        return { status: "success", finalText: "runner exited", errorMessage: null, sessionId: "runner-session" };
      },
    });

    const persisted = getOrCreateRunForRepo(repoDir);
    expect(persisted.tasks[0]).toMatchObject({ state: "needs_review", activeRunId: null });
    expect(persisted.runs[0]).toMatchObject({ status: "partial", completionSummary: "runner exited" });
    expect(persisted.gates[0]).toMatchObject({ type: "needs_review", status: "open" });
  });

  it("retries fallback exit finalization while the conductor state lock is briefly held", async () => {
    const { started, contractPath, nonce } = await createStartedContract();
    const lockPath = getRunLockFile(deriveProjectKey(resolve(repoDir)));

    await runRunnerFromContract({
      contractPath,
      nonce,
      async runWorker() {
        writeFileSync(lockPath, JSON.stringify({ pid: 123, createdAt: new Date().toISOString() }));
        setTimeout(() => unlinkSync(lockPath), 25);
        return {
          status: "success",
          finalText: "runner exited after lock",
          errorMessage: null,
          sessionId: "runner-session",
        };
      },
    });

    expect(getOrCreateRunForRepo(repoDir).runs.find((entry) => entry.runId === started.run.runId)).toMatchObject({
      status: "partial",
      completionSummary: "runner exited after lock",
    });
  });

  it("audits stale runner completion after cancellation without changing terminal state", async () => {
    const { task, started, contractPath, nonce } = await createStartedContract();

    await runRunnerFromContract({
      contractPath,
      nonce,
      async runWorker(input) {
        await cancelTaskRunForRepo(repoDir, { runId: started.run.runId, reason: "human stopped it" });
        await input.onConductorComplete?.({
          runId: started.run.runId,
          taskId: task.taskId,
          status: "succeeded",
          completionSummary: "late success",
        });
        return { status: "success", finalText: "late", errorMessage: null, sessionId: "runner-session" };
      },
    });

    const persisted = getOrCreateRunForRepo(repoDir);
    expect(persisted.tasks[0]).toMatchObject({ state: "canceled", activeRunId: null });
    expect(persisted.runs[0]).toMatchObject({ status: "aborted", completionSummary: null });
    expect(persisted.events.map((event) => event.type)).toContain("task.completion_rejected");
  });

  it("rejects scoped runner callbacks that target a different active run", async () => {
    const first = await createStartedContract("first-nonce");
    const second = await createStartedContract("second-nonce");

    await expect(
      runRunnerFromContract({
        contractPath: first.contractPath,
        nonce: first.nonce,
        async runWorker(input) {
          await input.onConductorComplete?.({
            runId: second.started.run.runId,
            taskId: second.task.taskId,
            status: "succeeded",
            completionSummary: "forged completion",
          });
          return { status: "success", finalText: "forged", errorMessage: null, sessionId: "runner-session" };
        },
      }),
    ).rejects.toThrow(/Runner contract scope mismatch/i);

    const persisted = getOrCreateRunForRepo(repoDir);
    const secondRun = persisted.runs.find((entry) => entry.runId === second.started.run.runId);
    const secondTask = persisted.tasks.find((entry) => entry.taskId === second.task.taskId);
    expect(secondRun).toMatchObject({ status: "running", completionSummary: null });
    expect(secondTask).toMatchObject({ state: "running", activeRunId: second.started.run.runId });
  });

  it("creates scoped follow-up tasks from active runner callbacks", async () => {
    const { task, started, contractPath, nonce } = await createStartedContract("followup-nonce");

    await runRunnerFromContract({
      contractPath,
      nonce,
      async runWorker(input) {
        await input.onConductorFollowUpTask?.({
          runId: started.run.runId,
          taskId: task.taskId,
          title: "Follow up",
          prompt: "Continue from the runner",
        });
        await input.onConductorComplete?.({
          runId: started.run.runId,
          taskId: task.taskId,
          status: "succeeded",
          completionSummary: "done",
        });
        return { status: "success", finalText: "done", errorMessage: null, sessionId: "runner-session" };
      },
    });

    const persisted = getOrCreateRunForRepo(repoDir);
    expect(persisted.tasks.map((entry) => entry.title)).toContain("Follow up");
    expect(persisted.events.map((event) => event.type)).toContain("task.followup_created");
  });

  it("rejects scoped runner follow-up tasks after the scoped run is canceled", async () => {
    const { task, started, contractPath, nonce } = await createStartedContract("canceled-followup-nonce");

    await expect(
      runRunnerFromContract({
        contractPath,
        nonce,
        async runWorker(input) {
          cancelTaskRunForRepo(repoDir, { runId: started.run.runId, reason: "human stopped it" });
          await input.onConductorFollowUpTask?.({
            runId: started.run.runId,
            taskId: task.taskId,
            title: "Late follow up",
            prompt: "Should not be created",
          });
          return { status: "success", finalText: "late", errorMessage: null, sessionId: "runner-session" };
        },
      }),
    ).rejects.toThrow(/Run .* is not active|active run/i);

    expect(getOrCreateRunForRepo(repoDir).tasks).toHaveLength(1);
  });

  it("rejects scoped runner follow-up tasks that target a different active run", async () => {
    const first = await createStartedContract("followup-first-nonce");
    const second = await createStartedContract("followup-second-nonce");

    await expect(
      runRunnerFromContract({
        contractPath: first.contractPath,
        nonce: first.nonce,
        async runWorker(input) {
          await input.onConductorFollowUpTask?.({
            runId: second.started.run.runId,
            taskId: second.task.taskId,
            title: "Forged follow up",
            prompt: "Should not be created",
          });
          return { status: "success", finalText: "forged", errorMessage: null, sessionId: "runner-session" };
        },
      }),
    ).rejects.toThrow(/Runner contract scope mismatch/i);

    expect(getOrCreateRunForRepo(repoDir).tasks.map((entry) => entry.title)).not.toContain("Forged follow up");
  });

  it("rejects scoped runner gates after the scoped run is canceled", async () => {
    const { task, started, contractPath, nonce } = await createStartedContract("canceled-gate-nonce");

    await expect(
      runRunnerFromContract({
        contractPath,
        nonce,
        async runWorker(input) {
          await cancelTaskRunForRepo(repoDir, { runId: started.run.runId, reason: "human stopped it" });
          await input.onConductorGate?.({
            runId: started.run.runId,
            taskId: task.taskId,
            type: "needs_review",
            requestedDecision: "late gate",
          });
          return { status: "success", finalText: "late gate", errorMessage: null, sessionId: "runner-session" };
        },
      }),
    ).rejects.toThrow(/Run .* is not active|Cannot create gate for inactive run/i);

    expect(getOrCreateRunForRepo(repoDir).gates).toHaveLength(0);
  });

  it("rejects scoped runner gates that target a different active run", async () => {
    const first = await createStartedContract("gate-first-nonce");
    const second = await createStartedContract("gate-second-nonce");

    await expect(
      runRunnerFromContract({
        contractPath: first.contractPath,
        nonce: first.nonce,
        async runWorker(input) {
          await input.onConductorGate?.({
            runId: second.started.run.runId,
            taskId: second.task.taskId,
            type: "needs_review",
            requestedDecision: "forged gate",
          });
          return { status: "success", finalText: "forged", errorMessage: null, sessionId: "runner-session" };
        },
      }),
    ).rejects.toThrow(/Runner contract scope mismatch/i);

    expect(getOrCreateRunForRepo(repoDir).gates).toHaveLength(0);
  });

  it("allows scoped runner callbacks after runtime metadata records the contract path", async () => {
    const { task, started, contractPath, nonce } = await createStartedContract("expected-nonce");
    const expectedHash = createHash("sha256").update(nonce).digest("hex");
    const run = getOrCreateRunForRepo(repoDir);
    writeRun({
      ...run,
      runs: run.runs.map((entry) =>
        entry.runId === started.run.runId
          ? { ...entry, runtime: { ...entry.runtime, contractPath, nonceHash: expectedHash } }
          : entry,
      ),
    });

    await runRunnerFromContract({
      contractPath,
      nonce,
      async runWorker(input) {
        await input.onConductorProgress?.({
          runId: started.run.runId,
          taskId: task.taskId,
          progress: "working with bound contract path",
        });
        await input.onConductorComplete?.({
          runId: started.run.runId,
          taskId: task.taskId,
          status: "succeeded",
          completionSummary: "done",
        });
        return { status: "success", finalText: "done", errorMessage: null, sessionId: "runner-session" };
      },
    });

    expect(getOrCreateRunForRepo(repoDir).events.map((event) => event.type)).toContain("run.progress_reported");
  });

  it("rejects forged contracts whose nonce is not bound to persisted run metadata", async () => {
    const { contract, contractPath, nonce } = await createStartedContract("expected-nonce");
    const expectedHash = createHash("sha256").update(nonce).digest("hex");
    const run = getOrCreateRunForRepo(repoDir);
    writeRun({
      ...run,
      runs: run.runs.map((entry) =>
        entry.runId === contract.taskContract.runId
          ? { ...entry, runtime: { ...entry.runtime, contractPath, nonceHash: expectedHash } }
          : entry,
      ),
    });
    const forgedContractPath = join(conductorHome, "forged-contract.json");
    writeRunnerContract(forgedContractPath, {
      ...contract,
      nonceHash: createHash("sha256").update("forged-nonce").digest("hex"),
    });

    await expect(
      runRunnerFromContract({
        contractPath: forgedContractPath,
        nonce: "forged-nonce",
        async runWorker() {
          throw new Error("should not run");
        },
      }),
    ).rejects.toThrow(/nonce mismatch|contract path mismatch/i);

    const persisted = getOrCreateRunForRepo(repoDir);
    expect(persisted.tasks[0]).toMatchObject({ state: "running", activeRunId: contract.taskContract.runId });
  });

  it("rejects stale or forged runner contracts before mutating state", async () => {
    const { contract, contractPath } = await createStartedContract("expected-nonce");

    expect(() =>
      validateRunnerContractForRepo({ repoRoot: repoDir, contract, nonce: "wrong-nonce", requireActive: true }),
    ).toThrow(/nonce mismatch/i);
    await expect(
      runRunnerFromContract({
        contractPath,
        nonce: "wrong-nonce",
        async runWorker() {
          throw new Error("should not run");
        },
      }),
    ).rejects.toThrow(/nonce mismatch/i);

    const persisted = getOrCreateRunForRepo(repoDir);
    expect(persisted.tasks[0]).toMatchObject({ state: "running", activeRunId: contract.taskContract.runId });
  });
});
