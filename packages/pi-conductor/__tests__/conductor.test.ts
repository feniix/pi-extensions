import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assignTaskForRepo,
  cancelActiveWorkForRepo,
  cancelTaskRunForRepo,
  createFollowUpTaskForRepo,
  createTaskForRepo,
  createWorkerForRepo,
  delegateTaskForRepo,
  getOrCreateRunForRepo,
  reconcileProjectForRepo,
  retryTaskForRepo,
  runParallelWorkForRepo,
  runTaskForRepo,
  runWorkForRepo,
  startTaskRunForRepo,
  updateTaskForRepo,
} from "../extensions/conductor.js";
import { deriveProjectKey } from "../extensions/project-key.js";
import { getRunFile, writeRun } from "../extensions/storage.js";
import { summarizeRunWorkRuntime } from "../extensions/work-runtime-summary.js";

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    throw new Error(message);
  }
  return value;
}

function forceTmuxUnavailable(): () => void {
  return withFakeTmux("exit 127");
}

function forceTmuxAvailable(): () => void {
  return withFakeTmux("printf 'tmux 3.4\\n'");
}

function withFakeTmux(scriptBody: string): () => void {
  const originalPath = process.env.PATH;
  const fakeBin = mkdtempSync(join(tmpdir(), "pi-conductor-fake-bin-"));
  const fakeTmux = join(fakeBin, "tmux");
  writeFileSync(fakeTmux, `#!/bin/sh\n${scriptBody}\n`, "utf-8");
  chmodSync(fakeTmux, 0o755);
  process.env.PATH = `${fakeBin}:${originalPath ?? ""}`;
  return () => {
    process.env.PATH = originalPath;
    rmSync(fakeBin, { recursive: true, force: true });
  };
}

describe("conductor service", () => {
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

  it("creates and persists an empty run for a repo", () => {
    const run = getOrCreateRunForRepo(repoDir);
    expect(run.repoRoot).toBe(repoDir);
    expect(run.workers).toEqual([]);
    expect(readFileSync(join(run.storageDir, "run.json"), "utf-8")).toContain("projectKey");
  });

  it("creates and assigns durable tasks through conductor service helpers", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, {
      title: "Add task ledger",
      prompt: "Implement durable task records",
    });

    expect(task.title).toBe("Add task ledger");
    expect(task.state).toBe("ready");

    const assigned = assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    expect(assigned.state).toBe("assigned");
    expect(assigned.assignedWorkerId).toBe(worker.workerId);

    const run = getOrCreateRunForRepo(repoDir);
    expect(run.tasks).toHaveLength(1);
    expect(run.tasks[0]?.taskId).toBe(task.taskId);
    expect(run.events.map((event) => event.type)).toEqual(["worker.created", "task.created", "task.assigned"]);
  });

  it("lets allowed child runs create follow-up tasks", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Primary", prompt: "Do it" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, {
      taskId: task.taskId,
      workerId: worker.workerId,
      allowFollowUpTasks: true,
    });

    expect(started.taskContract.allowFollowUpTasks).toBe(true);
    const followUp = createFollowUpTaskForRepo(repoDir, {
      runId: started.run.runId,
      taskId: task.taskId,
      title: "Follow-up",
      prompt: "Do more",
    });

    expect(followUp).toMatchObject({ title: "Follow-up", prompt: "Do more", state: "ready" });
    const run = getOrCreateRunForRepo(repoDir);
    expect(run.tasks).toHaveLength(2);
    expect(run.events.map((event) => event.type)).toContain("task.followup_created");
  });

  it("fails closed when an unsupported backend is requested", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Subagent task", prompt: "Do it elsewhere" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);

    expect(() =>
      startTaskRunForRepo(repoDir, {
        taskId: task.taskId,
        workerId: worker.workerId,
        backend: "pi-subagents",
        inspectBackends: () => ({
          native: {
            available: true,
            canonicalStateOwner: "conductor",
            capabilities: {
              canStartRun: true,
              canRunForeground: true,
              supportsScopedChildTools: true,
              requiresReviewOnExit: true,
            },
            diagnostic: null,
          },
          piSubagents: {
            available: false,
            canonicalStateOwner: "conductor",
            capabilities: {
              canStartRun: false,
              canRunForeground: false,
              supportsScopedChildTools: false,
              requiresReviewOnExit: true,
            },
            diagnostic: "not installed in test",
          },
        }),
      }),
    ).toThrow(/pi-subagents backend unavailable/i);

    const run = getOrCreateRunForRepo(repoDir);
    expect(run.runs).toHaveLength(0);
    expect(run.tasks[0]).toMatchObject({ state: "assigned", activeRunId: null });
    expect(run.events.at(-1)).toMatchObject({ type: "backend.unavailable" });
  });

  it("starts an assigned durable task run through conductor service helpers", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Add run ledger", prompt: "Implement durable runs" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);

    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId, leaseSeconds: 300 });

    expect(started.run.taskId).toBe(task.taskId);
    expect(started.run.workerId).toBe(worker.workerId);
    expect(started.run.status).toBe("running");
    expect(started.taskContract).toMatchObject({
      taskId: task.taskId,
      runId: started.run.runId,
      goal: "Implement durable runs",
      explicitCompletionTools: true,
    });

    const run = getOrCreateRunForRepo(repoDir);
    expect(run.tasks[0]).toMatchObject({ state: "running", activeRunId: started.run.runId });
  });

  it("does not start two active runs on the same worker", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const first = createTaskForRepo(repoDir, { title: "First", prompt: "Do first work" });
    const second = createTaskForRepo(repoDir, { title: "Second", prompt: "Do second work" });
    assignTaskForRepo(repoDir, first.taskId, worker.workerId);
    assignTaskForRepo(repoDir, second.taskId, worker.workerId);
    startTaskRunForRepo(repoDir, { taskId: first.taskId, workerId: worker.workerId });

    expect(() => startTaskRunForRepo(repoDir, { taskId: second.taskId, workerId: worker.workerId })).toThrow(
      /cannot start another run/i,
    );
  });

  it("delegates a task through the parent-agent happy path", async () => {
    const delegated = await delegateTaskForRepo(repoDir, {
      title: "Happy path",
      prompt: "Implement the happy path",
      workerName: "backend",
      startRun: true,
      leaseSeconds: 300,
    });

    expect(delegated.worker.name).toBe("backend");
    expect(delegated.task).toMatchObject({
      title: "Happy path",
      state: "running",
      assignedWorkerId: delegated.worker.workerId,
    });
    expect(delegated.run).toMatchObject({
      taskId: delegated.task.taskId,
      workerId: delegated.worker.workerId,
      status: "running",
    });
    expect(delegated.taskContract).toMatchObject({ taskId: delegated.task.taskId, runId: delegated.run?.runId });

    const run = getOrCreateRunForRepo(repoDir);
    expect(run.workers).toHaveLength(1);
    expect(run.tasks).toHaveLength(1);
    expect(run.runs).toHaveLength(1);
  });

  it("fails closed when a delegated start requests an unavailable runtime mode", async () => {
    const restorePath = forceTmuxUnavailable();
    try {
      await expect(
        delegateTaskForRepo(repoDir, {
          title: "Visible delegated work",
          prompt: "Run visibly",
          workerName: "visible-worker",
          startRun: true,
          runtimeMode: "iterm-tmux",
        }),
      ).rejects.toThrow(/Runtime mode iterm-tmux unavailable/i);

      const run = getOrCreateRunForRepo(repoDir);
      expect(run.tasks[0]).toMatchObject({ state: "assigned", activeRunId: null, runIds: [] });
      expect(run.runs).toHaveLength(0);
    } finally {
      restorePath();
    }
  });

  it("cancels active conductor work without requiring run IDs", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Cancelable", prompt: "Do it" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId });

    const canceled = await cancelActiveWorkForRepo(repoDir, { reason: "human pressed escape" });

    expect(canceled.canceledRuns).toEqual([started.run.runId]);
    expect(canceled.canceledTasks).toEqual([task.taskId]);
    expect(canceled.project.runs[0]).toMatchObject({ status: "aborted", errorMessage: "human pressed escape" });
    expect(canceled.project.tasks[0]).toMatchObject({ state: "canceled", activeRunId: null });
    expect(canceled.project.workers[0]).toMatchObject({ lifecycle: "idle" });
  });

  it("does not start parallel work when the orchestration signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let startedCount = 0;

    const result = await runParallelWorkForRepo(
      repoDir,
      {
        workerPrefix: "parallel",
        tasks: [
          { title: "First shard", prompt: "Do first shard" },
          { title: "Second shard", prompt: "Do second shard" },
        ],
      },
      controller.signal,
      async (root, taskId) => {
        startedCount += 1;
        return runTaskForRepo(root, taskId, controller.signal);
      },
    );

    expect(startedCount).toBe(0);
    expect(result.canceledTasks).toHaveLength(2);
    const run = getOrCreateRunForRepo(repoDir);
    expect(run.tasks.map((task) => task.state)).toEqual(["canceled", "canceled"]);
    expect(run.runs).toHaveLength(0);
  });

  it("runs parallel work under one abortable orchestration boundary", async () => {
    const controller = new AbortController();
    let startedCount = 0;

    const result = await runParallelWorkForRepo(
      repoDir,
      {
        workerPrefix: "parallel",
        tasks: [
          { title: "First shard", prompt: "Do first shard" },
          { title: "Second shard", prompt: "Do second shard" },
        ],
      },
      controller.signal,
      async (root, taskId) => {
        const started = startTaskRunForRepo(root, { taskId });
        startedCount += 1;
        if (startedCount === 2) controller.abort();
        return {
          workerName: started.run.workerId,
          status: "aborted",
          finalText: null,
          errorMessage: null,
          sessionId: null,
        };
      },
    );

    expect(result.tasks.map((task) => task.title)).toEqual(["First shard", "Second shard"]);
    expect(result.canceledRuns).toHaveLength(2);
    expect(result.canceledTasks).toHaveLength(2);
    const run = getOrCreateRunForRepo(repoDir);
    expect(run.workers.map((worker) => worker.lifecycle)).toEqual(["idle", "idle"]);
    expect(run.tasks.map((task) => task.state)).toEqual(["canceled", "canceled"]);
    expect(run.runs.map((attempt) => attempt.status)).toEqual(["aborted", "aborted"]);
  });

  it("aborts live parallel runners when active work is canceled", async () => {
    let runnerSignal: AbortSignal | undefined;

    const result = await runParallelWorkForRepo(
      repoDir,
      {
        workerPrefix: "parallel",
        tasks: [{ title: "Cancelable shard", prompt: "Do cancelable shard" }],
      },
      undefined,
      async (_root, _taskId, signal) => {
        runnerSignal = signal;
        const canceled = await cancelActiveWorkForRepo(repoDir, { reason: "human asked to stop" });
        expect(canceled.canceledTasks).toHaveLength(1);
        expect(runnerSignal?.aborted).toBe(true);
        return {
          workerName: "parallel-1",
          status: "aborted",
          finalText: null,
          errorMessage: "human asked to stop",
          sessionId: null,
        };
      },
    );

    expect(result.canceledTasks).toHaveLength(1);
    expect(runnerSignal?.aborted).toBe(true);
  });

  it("rejects duplicate worker names for parallel work before dispatch", async () => {
    await expect(
      runParallelWorkForRepo(repoDir, {
        tasks: [
          { title: "First shard", prompt: "Do first shard", workerName: "same-worker" },
          { title: "Second shard", prompt: "Do second shard", workerName: "same-worker" },
        ],
      }),
    ).rejects.toThrow(/duplicate parallel worker name/i);
  });

  it("rejects parallel reuse of a busy worker", async () => {
    const worker = await createWorkerForRepo(repoDir, "busy-worker");
    const task = createTaskForRepo(repoDir, { title: "Busy task", prompt: "Keep the worker busy" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId });

    await expect(
      runParallelWorkForRepo(repoDir, {
        tasks: [{ title: "New shard", prompt: "Do new shard", workerName: "busy-worker" }],
      }),
    ).rejects.toThrow(/not idle/i);
  });

  it("runs small natural-language work as one conductor worker by default", async () => {
    const result = await runWorkForRepo(
      repoDir,
      {
        request: "Fix the typo in README.md",
        tasks: [{ title: "Fix README typo", prompt: "Fix the typo in README.md", writeScope: ["README.md"] }],
      },
      undefined,
      async () => ({ workerName: "single", status: "success", finalText: "done", errorMessage: null, sessionId: null }),
    );

    expect(result.decision).toMatchObject({
      mode: "single",
      reason: expect.stringMatching(/single/i),
    });
    expect(result.tasks.map((task) => task.title)).toEqual(["Fix README typo"]);
    expect(result.parallel).toBeNull();
    const run = getOrCreateRunForRepo(repoDir);
    expect(run.workers).toHaveLength(1);
    expect(run.tasks).toHaveLength(1);
  });

  it("passes normalized headless runtimeMode through default natural-language work runners", async () => {
    let seenRuntimeMode: string | undefined;

    const result = await runWorkForRepo(
      repoDir,
      {
        request: "Fix the typo in README.md",
        tasks: [{ title: "Fix README typo", prompt: "Fix the typo in README.md", writeScope: ["README.md"] }],
      },
      undefined,
      async (_root, taskId, _signal, options) => {
        seenRuntimeMode = options?.runtimeMode;
        return { workerName: taskId, status: "success", finalText: "done", errorMessage: null, sessionId: null };
      },
    );

    expect(result.runtimeMode).toBe("headless");
    expect(seenRuntimeMode).toBe("headless");
  });

  it("passes runtimeMode through parallel work runners", async () => {
    const restorePath = forceTmuxAvailable();
    const seenRuntimeModes: Array<string | undefined> = [];

    try {
      await runParallelWorkForRepo(
        repoDir,
        {
          workerPrefix: "parallel",
          runtimeMode: "tmux",
          tasks: [
            { title: "First shard", prompt: "Do first shard" },
            { title: "Second shard", prompt: "Do second shard" },
          ],
        },
        undefined,
        async (_root, taskId, _signal, options) => {
          seenRuntimeModes.push(options?.runtimeMode);
          return { workerName: taskId, status: "success", finalText: "done", errorMessage: null, sessionId: null };
        },
      );
    } finally {
      restorePath();
    }

    expect(seenRuntimeModes).toEqual(["tmux", "tmux"]);
  });

  it("fails direct visible parallel runtime preflight before creating workers or tasks", async () => {
    const restorePath = forceTmuxUnavailable();
    try {
      await expect(
        runParallelWorkForRepo(repoDir, {
          workerPrefix: "parallel",
          runtimeMode: "tmux",
          tasks: [
            { title: "First shard", prompt: "Do first shard" },
            { title: "Second shard", prompt: "Do second shard" },
          ],
        }),
      ).rejects.toThrow(/Runtime mode tmux unavailable/i);

      const run = getOrCreateRunForRepo(repoDir);
      expect(run.workers).toHaveLength(0);
      expect(run.tasks).toHaveLength(0);
      expect(run.runs).toHaveLength(0);
    } finally {
      restorePath();
    }
  });

  it("infers visible runtime for natural-language visible parallel requests", async () => {
    const restorePath = forceTmuxAvailable();
    const seenRuntimeModes: Array<string | undefined> = [];

    let result: Awaited<ReturnType<typeof runWorkForRepo>> | null = null;
    try {
      result = await runWorkForRepo(
        repoDir,
        {
          request: "Run these independent shards in parallel and show me the workers",
          tasks: [
            { title: "Inspect README", prompt: "Inspect README.md", writeScope: ["README.md"] },
            { title: "Inspect package", prompt: "Inspect package metadata", writeScope: ["package.json"] },
          ],
        },
        undefined,
        async (_root, taskId, _signal, options) => {
          seenRuntimeModes.push(options?.runtimeMode);
          return { workerName: taskId, status: "success", finalText: "done", errorMessage: null, sessionId: null };
        },
      );
    } finally {
      restorePath();
    }
    if (!result) throw new Error("expected runWorkForRepo result");

    expect(result.decision.mode).toBe("parallel");
    expect(result.runtimeMode).toBe("iterm-tmux");
    expect(seenRuntimeModes).toEqual(["iterm-tmux", "iterm-tmux"]);
  });

  it("rejects status-only work-router requests with candidate tasks before mutating conductor state", async () => {
    await expect(
      runWorkForRepo(
        repoDir,
        {
          request: "show me current workers",
          tasks: [{ title: "Inspect workers", prompt: "Inspect current workers", writeScope: ["README.md"] }],
        },
        undefined,
        async (_root, taskId) => ({
          workerName: taskId,
          status: "success",
          finalText: "done",
          errorMessage: null,
          sessionId: null,
        }),
      ),
    ).rejects.toThrow(/status-only requests/i);

    const run = getOrCreateRunForRepo(repoDir);
    expect(run.workers).toHaveLength(0);
    expect(run.tasks).toHaveLength(0);
    expect(run.runs).toHaveLength(0);
  });

  it.each([
    "show me current workers",
    "watch current worker status",
    "open current run output",
    "open run output",
    "tail run log",
    "watch worker status",
    "open logs",
    "what's running?",
    "are any workers active?",
    "current worker status",
  ])("rejects status-only work-router requests before mutating conductor state: %s", async (request) => {
    await expect(runWorkForRepo(repoDir, { request })).rejects.toThrow(/status-only requests/i);

    const run = getOrCreateRunForRepo(repoDir);
    expect(run.workers).toHaveLength(0);
    expect(run.tasks).toHaveLength(0);
    expect(run.runs).toHaveLength(0);
  });

  it("rejects status-only planning requests before mutating conductor state", async () => {
    await expect(runWorkForRepo(repoDir, { request: "show run status", execute: false })).rejects.toThrow(
      /status-only requests/i,
    );

    const run = getOrCreateRunForRepo(repoDir);
    expect(run.workers).toHaveLength(0);
    expect(run.tasks).toHaveLength(0);
    expect(run.runs).toHaveLength(0);
  });

  it("rejects status-only requests with explicit runtime before mutating conductor state", async () => {
    await expect(
      runWorkForRepo(repoDir, {
        request: "show me current workers",
        runtimeMode: "iterm-tmux",
        tasks: [{ title: "Inspect workers", prompt: "Inspect current workers", writeScope: ["README.md"] }],
      }),
    ).rejects.toThrow(/status-only requests/i);

    const run = getOrCreateRunForRepo(repoDir);
    expect(run.workers).toHaveLength(0);
    expect(run.tasks).toHaveLength(0);
    expect(run.runs).toHaveLength(0);
  });

  it("fails inferred visible runtime preflight without creating active runs", async () => {
    const restorePath = forceTmuxUnavailable();
    try {
      await expect(
        runWorkForRepo(repoDir, {
          request: "Run this focused task and show me the worker",
          tasks: [{ title: "Visible focused task", prompt: "Do visible work", writeScope: ["README.md"] }],
        }),
      ).rejects.toThrow(/Runtime mode iterm-tmux unavailable/i);

      const run = getOrCreateRunForRepo(repoDir);
      expect(run.workers).toHaveLength(0);
      expect(run.tasks).toHaveLength(0);
      expect(run.runs).toHaveLength(0);
    } finally {
      restorePath();
    }
  });

  it("fails inferred visible parallel preflight before creating workers or tasks", async () => {
    const restorePath = forceTmuxUnavailable();
    try {
      await expect(
        runWorkForRepo(repoDir, {
          request: "Run these independent shards in parallel and show me the workers",
          tasks: [
            { title: "Visible shard one", prompt: "Do visible work one", writeScope: ["README.md"] },
            { title: "Visible shard two", prompt: "Do visible work two", writeScope: ["package.json"] },
          ],
        }),
      ).rejects.toThrow(/Runtime mode iterm-tmux unavailable/i);

      const run = getOrCreateRunForRepo(repoDir);
      expect(run.workers).toHaveLength(0);
      expect(run.tasks).toHaveLength(0);
      expect(run.runs).toHaveLength(0);
    } finally {
      restorePath();
    }
  });

  it("returns structured runtime summaries for natural-language visible work", async () => {
    const restorePath = forceTmuxAvailable();
    let result: Awaited<ReturnType<typeof runWorkForRepo>> | null = null;
    try {
      result = await runWorkForRepo(
        repoDir,
        {
          request: "Run this focused task and show me the worker",
          tasks: [{ title: "Visible summary", prompt: "Do visible work", writeScope: ["README.md"] }],
        },
        undefined,
        async (root, taskId, _signal, options) => {
          const started = startTaskRunForRepo(root, { taskId, runtimeMode: options?.runtimeMode });
          const latest = getOrCreateRunForRepo(root);
          writeRun({
            ...latest,
            tasks: latest.tasks.map((task) =>
              task.taskId === taskId ? { ...task, latestProgress: "opening viewer" } : task,
            ),
            runs: latest.runs.map((run) =>
              run.runId === started.run.runId
                ? {
                    ...run,
                    runtime: {
                      ...run.runtime,
                      mode: "iterm-tmux",
                      status: "running",
                      viewerStatus: "opened",
                      viewerCommand: "tmux attach-session -r -t pi-cond-run",
                      logPath: "/tmp/pi-conductor/runtime/run-1/runner.log",
                      diagnostics: ["iTerm2 viewer opened"],
                    },
                  }
                : run,
            ),
          });
          return { workerName: taskId, status: "success", finalText: "done", errorMessage: null, sessionId: null };
        },
      );
    } finally {
      restorePath();
    }
    if (!result) throw new Error("expected runWorkForRepo result");

    expect(result.runtimeRuns).toHaveLength(1);
    expect(result.runtimeRuns[0]).toMatchObject({
      taskId: result.tasks[0]?.taskId,
      runtimeMode: "iterm-tmux",
      runtimeStatus: "running",
      viewerStatus: "opened",
      viewerCommand: "tmux attach-session -r -t pi-cond-run",
      logPath: "/tmp/pi-conductor/runtime/run-1/runner.log",
      diagnostic: "iTerm2 viewer opened",
      latestProgress: "opening viewer",
      cancelTool: { name: "conductor_cancel_task_run", params: { reason: "Parent requested cancellation" } },
    });
    expect(result.runtimeRuns[0]?.cancelCommand).toContain("Parent requested cancellation");
  });

  it("omits runtime cancellation details for terminal run summaries", async () => {
    const delegated = await delegateTaskForRepo(repoDir, {
      title: "Terminal summary",
      prompt: "Summarize terminal runtime",
      workerName: "terminal-summary",
      startRun: false,
    });
    const started = startTaskRunForRepo(repoDir, {
      taskId: delegated.task.taskId,
      workerId: delegated.worker.workerId,
    });
    const latest = getOrCreateRunForRepo(repoDir);
    writeRun({
      ...latest,
      runs: latest.runs.map((run) =>
        run.runId === started.run.runId ? { ...run, status: "succeeded", finishedAt: new Date().toISOString() } : run,
      ),
    });

    const summary = summarizeRunWorkRuntime(repoDir, [delegated.task.taskId]);
    expect(summary[0]).toMatchObject({ cancelCommand: null, cancelTool: null });
  });

  it("passes runtimeMode through single natural-language work runners", async () => {
    const restorePath = forceTmuxAvailable();
    let seenRuntimeMode: string | undefined;

    try {
      await runWorkForRepo(
        repoDir,
        {
          request: "Fix one focused issue",
          runtimeMode: "iterm-tmux",
          tasks: [{ title: "Fix one issue", prompt: "Fix it", writeScope: ["README.md"] }],
        },
        undefined,
        async (_root, taskId, _signal, options) => {
          seenRuntimeMode = options?.runtimeMode;
          return { workerName: taskId, status: "success", finalText: "done", errorMessage: null, sessionId: null };
        },
      );
    } finally {
      restorePath();
    }

    expect(seenRuntimeMode).toBe("iterm-tmux");
  });

  it("routes independent scoped work items to parallel workers", async () => {
    const result = await runWorkForRepo(
      repoDir,
      {
        request: "Deep dive these independent pi-conductor areas in parallel",
        maxWorkers: 3,
        tasks: [
          { title: "Inspect README", prompt: "Inspect README.md", writeScope: ["README.md"] },
          { title: "Inspect tests", prompt: "Inspect tests", writeScope: ["__tests__/"] },
          { title: "Inspect runtime", prompt: "Inspect runtime", writeScope: ["extensions/runtime.ts"] },
        ],
      },
      undefined,
      async (_root, taskId) => ({
        workerName: taskId,
        status: "success",
        finalText: "done",
        errorMessage: null,
        sessionId: null,
      }),
    );

    expect(result.decision).toMatchObject({
      mode: "parallel",
      reason: expect.stringMatching(/independent/i),
    });
    expect(result.parallel?.results).toHaveLength(3);
    const run = getOrCreateRunForRepo(repoDir);
    expect(run.workers.map((worker) => worker.name)).toEqual(["run-work-1", "run-work-2", "run-work-3"]);
  });

  it("does not split work with overlapping write scopes", async () => {
    const result = await runWorkForRepo(
      repoDir,
      {
        request: "Split the runtime refactor across workers",
        tasks: [
          { title: "Refactor runtime setup", prompt: "Refactor runtime setup", writeScope: ["extensions/runtime.ts"] },
          { title: "Refactor runtime tests", prompt: "Refactor runtime tests", writeScope: ["extensions/runtime.ts"] },
        ],
      },
      undefined,
      async () => ({ workerName: "single", status: "success", finalText: "done", errorMessage: null, sessionId: null }),
    );

    expect(result.decision).toMatchObject({
      mode: "single",
      riskFlags: expect.arrayContaining(["overlapping_write_scope"]),
    });
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.prompt).toContain("Refactor runtime setup");
    expect(result.tasks[0]?.prompt).toContain("Refactor runtime tests");
  });

  it("does not split work with nested write scopes", async () => {
    const result = await runWorkForRepo(
      repoDir,
      {
        request: "Split the runtime refactor across workers",
        tasks: [
          { title: "Refactor extensions", prompt: "Refactor extension modules", writeScope: ["extensions/"] },
          {
            title: "Refactor runtime",
            prompt: "Refactor runtime module",
            writeScope: ["extensions/runtime.ts"],
          },
        ],
      },
      undefined,
      async () => ({ workerName: "single", status: "success", finalText: "done", errorMessage: null, sessionId: null }),
    );

    expect(result.decision).toMatchObject({
      mode: "single",
      riskFlags: expect.arrayContaining(["overlapping_write_scope"]),
    });
    expect(result.tasks).toHaveLength(1);
  });

  it("plans dependent work as an objective instead of parallel fan-out", async () => {
    const result = await runWorkForRepo(repoDir, {
      request: "Implement the feature, then verify it",
      execute: false,
      tasks: [
        { title: "Implement feature", prompt: "Implement the feature in the package", writeScope: ["extensions/"] },
        {
          title: "Verify feature",
          prompt: "Verify the feature after implementation",
          writeScope: ["__tests__/"],
          dependsOn: ["Implement feature"],
        },
      ],
    });

    expect(result.decision).toMatchObject({
      mode: "objective",
      reason: expect.stringMatching(/depend/i),
    });
    expect(result.objective?.tasks.map((task) => task.title)).toEqual(["Implement feature", "Verify feature"]);
    expect(result.parallel).toBeNull();
    const run = getOrCreateRunForRepo(repoDir);
    expect(run.objectives).toHaveLength(1);
    expect(run.tasks[1]?.dependsOnTaskIds).toEqual([run.tasks[0]?.taskId]);
  });

  it("updates durable tasks through conductor service helpers", () => {
    const task = createTaskForRepo(repoDir, { title: "Original", prompt: "Do it" });

    const updated = updateTaskForRepo(repoDir, { taskId: task.taskId, title: "Updated", prompt: "Do it better" });

    expect(updated).toMatchObject({ title: "Updated", prompt: "Do it better", revision: 2 });
    expect(getOrCreateRunForRepo(repoDir).events.map((event) => event.type)).toContain("task.updated");
  });

  it("rejects canceling terminal-status runs even if finishedAt is missing", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Corrupt terminal", prompt: "Do it" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId });
    const run = getOrCreateRunForRepo(repoDir);
    writeRun({
      ...run,
      tasks: run.tasks.map((entry) =>
        entry.taskId === task.taskId ? { ...entry, state: "failed", activeRunId: started.run.runId } : entry,
      ),
      runs: run.runs.map((entry) =>
        entry.runId === started.run.runId ? { ...entry, status: "failed", finishedAt: null } : entry,
      ),
    });

    const canceled = await cancelTaskRunForRepo(repoDir, { runId: started.run.runId, reason: "stop" });

    expect(canceled.runs[0]).toMatchObject({ status: "failed", finishedAt: null });
    expect(canceled.events.at(-1)).toMatchObject({ type: "run.cancel_rejected" });
  });

  it("cancels and retries task runs through conductor service helpers", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Retry task", prompt: "Do it" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId });

    const canceled = await cancelTaskRunForRepo(repoDir, {
      runId: started.run.runId,
      reason: "superseded attempt",
    });
    expect(canceled.runs[0]).toMatchObject({ status: "aborted" });
    expect(canceled.tasks[0]).toMatchObject({ state: "canceled", activeRunId: null });

    const restorePath = forceTmuxUnavailable();
    try {
      expect(() => retryTaskForRepo(repoDir, { taskId: task.taskId, runtimeMode: "iterm-tmux" })).toThrow(
        /Runtime mode iterm-tmux unavailable/i,
      );
      expect(getOrCreateRunForRepo(repoDir).tasks[0]?.runIds).toHaveLength(1);
    } finally {
      restorePath();
    }

    const retried = retryTaskForRepo(repoDir, { taskId: task.taskId, leaseSeconds: 300 });
    expect(retried.run.runId).not.toBe(started.run.runId);
    expect(retried.run).toMatchObject({ taskId: task.taskId, workerId: worker.workerId, status: "running" });
    expect(retried.taskContract).toMatchObject({ taskId: task.taskId, runId: retried.run.runId });
    expect(getOrCreateRunForRepo(repoDir).tasks[0]?.runIds).toHaveLength(2);
  });

  it("reconciles project leases and persists safe state transitions", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Lease task", prompt: "Do it" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId, leaseSeconds: -1 });

    const reconciled = reconcileProjectForRepo(repoDir, { now: "2999-01-01T00:00:00.000Z" });

    expect(reconciled.runs[0]).toMatchObject({ status: "stale" });
    expect(reconciled.tasks[0]).toMatchObject({ state: "needs_review", activeRunId: null });
    expect(getOrCreateRunForRepo(repoDir).events.map((event) => event.type)).toContain("run.lease_expired");
  });

  it("retries full tmux reconciliation when state changes during probing", async () => {
    const originalPath = process.env.PATH;
    const originalRunFile = process.env.PI_CONDUCTOR_TEST_RUN_FILE;
    const originalMarker = process.env.PI_CONDUCTOR_TEST_MARKER;
    const binDir = mkdtempSync(join(tmpdir(), "fake-tmux-bin-"));
    const markerPath = join(binDir, "updated-once");
    process.env.PI_CONDUCTOR_TEST_RUN_FILE = getRunFile(deriveProjectKey(repoDir));
    process.env.PI_CONDUCTOR_TEST_MARKER = markerPath;
    writeFileSync(
      join(binDir, "tmux"),
      `#!/bin/sh
if [ ! -f "$PI_CONDUCTOR_TEST_MARKER" ]; then
  touch "$PI_CONDUCTOR_TEST_MARKER"
  node - "$PI_CONDUCTOR_TEST_RUN_FILE" <<'NODE'
const fs = require('node:fs');
const path = process.argv[2];
const data = JSON.parse(fs.readFileSync(path, 'utf-8'));
data.updatedAt = '2026-04-27T00:00:00.123Z';
fs.writeFileSync(path, JSON.stringify(data, null, 2) + String.fromCharCode(10));
NODE
fi
case "$*" in *has-session*) exit 1 ;; *) exit 0 ;; esac
`,
      { mode: 0o755 },
    );
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;
    try {
      const worker = await createWorkerForRepo(repoDir, "tmux-race-worker");
      const task = createTaskForRepo(repoDir, { title: "Visible race", prompt: "Do it visibly" });
      assignTaskForRepo(repoDir, task.taskId, worker.workerId);
      const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId });
      const run = getOrCreateRunForRepo(repoDir);
      writeRun({
        ...run,
        runs: run.runs.map((attempt) =>
          attempt.runId === started.run.runId
            ? {
                ...attempt,
                runtime: {
                  ...attempt.runtime,
                  mode: "tmux",
                  tmux: { socketPath: "/tmp/racy-tmux.sock", sessionName: "missing", windowId: "@1", paneId: "%2" },
                },
              }
            : attempt,
        ),
      });

      const reconciled = reconcileProjectForRepo(repoDir, { now: "2026-04-27T00:00:00.000Z" });

      expect(reconciled.tasks[0]).toMatchObject({ state: "needs_review", activeRunId: null });
      expect(reconciled.runs[0]).toMatchObject({ status: "stale", errorMessage: expect.stringContaining("tmux") });
      expect(getOrCreateRunForRepo(repoDir).runs[0]).toMatchObject({ status: "stale" });
    } finally {
      process.env.PATH = originalPath;
      if (originalRunFile === undefined) delete process.env.PI_CONDUCTOR_TEST_RUN_FILE;
      else process.env.PI_CONDUCTOR_TEST_RUN_FILE = originalRunFile;
      if (originalMarker === undefined) delete process.env.PI_CONDUCTOR_TEST_MARKER;
      else process.env.PI_CONDUCTOR_TEST_MARKER = originalMarker;
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  it("reconciles missing tmux runtime sessions through project reconciliation", async () => {
    const worker = await createWorkerForRepo(repoDir, "tmux-worker");
    const task = createTaskForRepo(repoDir, { title: "Visible lease task", prompt: "Do it visibly" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId });
    const run = getOrCreateRunForRepo(repoDir);
    writeRun({
      ...run,
      runs: run.runs.map((attempt) =>
        attempt.runId === started.run.runId
          ? {
              ...attempt,
              runtime: {
                ...attempt.runtime,
                mode: "tmux",
                tmux: { socketPath: "/tmp/missing-tmux.sock", sessionName: "missing", windowId: "@1", paneId: "%2" },
              },
            }
          : attempt,
      ),
    });

    const reconciled = reconcileProjectForRepo(repoDir, { now: "2026-04-27T00:00:00.000Z" });

    expect(reconciled.tasks[0]).toMatchObject({ state: "needs_review", activeRunId: null });
    expect(reconciled.runs[0]).toMatchObject({ status: "stale", errorMessage: expect.stringContaining("tmux") });
  });

  it("reconciles missing iterm-tmux runtime sessions through project reconciliation", async () => {
    const worker = await createWorkerForRepo(repoDir, "iterm-tmux-worker");
    const task = createTaskForRepo(repoDir, { title: "Visible viewer lease task", prompt: "Do it visibly" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId });
    const run = getOrCreateRunForRepo(repoDir);
    writeRun({
      ...run,
      runs: run.runs.map((attempt) =>
        attempt.runId === started.run.runId
          ? {
              ...attempt,
              runtime: {
                ...attempt.runtime,
                mode: "iterm-tmux",
                tmux: {
                  socketPath: "/tmp/missing-iterm-tmux.sock",
                  sessionName: "missing",
                  windowId: "@1",
                  paneId: "%2",
                },
              },
            }
          : attempt,
      ),
    });

    const reconciled = reconcileProjectForRepo(repoDir, { now: "2026-04-27T00:00:00.000Z" });

    expect(reconciled.tasks[0]).toMatchObject({ state: "needs_review", activeRunId: null });
    expect(reconciled.runs[0]).toMatchObject({ status: "stale", errorMessage: expect.stringContaining("tmux") });
  });

  it("does not expire active tmux runs while their tmux session is still present", async () => {
    const originalPath = process.env.PATH;
    const binDir = mkdtempSync(join(tmpdir(), "fake-tmux-bin-"));
    writeFileSync(join(binDir, "tmux"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;
    try {
      const worker = await createWorkerForRepo(repoDir, "live-tmux-worker");
      const task = createTaskForRepo(repoDir, { title: "Live visible lease task", prompt: "Do it visibly" });
      assignTaskForRepo(repoDir, task.taskId, worker.workerId);
      const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId });
      const run = getOrCreateRunForRepo(repoDir);
      writeRun({
        ...run,
        runs: run.runs.map((attempt) =>
          attempt.runId === started.run.runId
            ? {
                ...attempt,
                leaseExpiresAt: "2026-04-27T00:00:00.000Z",
                runtime: {
                  ...attempt.runtime,
                  mode: "tmux",
                  heartbeatAt: "2026-04-27T00:09:00.000Z",
                  tmux: { socketPath: "/tmp/live-tmux.sock", sessionName: "live", windowId: "@1", paneId: "%2" },
                },
              }
            : attempt,
        ),
      });

      const reconciled = reconcileProjectForRepo(repoDir, { now: "2026-04-27T00:10:00.000Z" });

      expect(reconciled.tasks[0]).toMatchObject({ state: "running", activeRunId: started.run.runId });
      expect(reconciled.workers[0]).toMatchObject({ lifecycle: "running" });
      expect(reconciled.runs[0]).toMatchObject({ status: "running", leaseExpiresAt: null });
    } finally {
      process.env.PATH = originalPath;
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  it("reconciles replaced tmux pane commands through project reconciliation", async () => {
    const originalPath = process.env.PATH;
    const binDir = mkdtempSync(join(tmpdir(), "fake-tmux-bin-"));
    writeFileSync(
      join(binDir, "tmux"),
      "#!/bin/sh\ncase \"$*\" in *display-message*) printf 'zsh\\n' ;; *) exit 0 ;; esac\n",
      { mode: 0o755 },
    );
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;
    try {
      const worker = await createWorkerForRepo(repoDir, "replaced-pane-worker");
      const task = createTaskForRepo(repoDir, { title: "Pane replaced", prompt: "Do it visibly" });
      assignTaskForRepo(repoDir, task.taskId, worker.workerId);
      const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId });
      const run = getOrCreateRunForRepo(repoDir);
      writeRun({
        ...run,
        runs: run.runs.map((attempt) =>
          attempt.runId === started.run.runId
            ? {
                ...attempt,
                runtime: {
                  ...attempt.runtime,
                  mode: "tmux",
                  command: "'node' '/tmp/pi-conductor-runner' 'run'",
                  heartbeatAt: "2026-04-27T00:09:00.000Z",
                  tmux: { socketPath: "/tmp/live-tmux.sock", sessionName: "live", windowId: "@1", paneId: "%2" },
                },
              }
            : attempt,
        ),
      });

      const reconciled = reconcileProjectForRepo(repoDir, { now: "2026-04-27T00:10:00.000Z" });

      expect(reconciled.tasks[0]).toMatchObject({ state: "needs_review", activeRunId: null });
      expect(reconciled.workers[0]).toMatchObject({ lifecycle: "broken", recoverable: true });
      expect(reconciled.runs[0]).toMatchObject({ status: "stale", errorMessage: expect.stringContaining("pane") });
    } finally {
      process.env.PATH = originalPath;
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  it("keeps stale-heartbeat tmux runs active when the runner pid is still alive", async () => {
    const originalPath = process.env.PATH;
    const binDir = mkdtempSync(join(tmpdir(), "fake-tmux-bin-"));
    writeFileSync(
      join(binDir, "tmux"),
      "#!/bin/sh\ncase \"$*\" in *display-message*) printf 'node\\n' ;; *) exit 0 ;; esac\n",
      {
        mode: 0o755,
      },
    );
    writeFileSync(join(binDir, "ps"), "#!/bin/sh\nprintf '4242\\n'\n", { mode: 0o755 });
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;
    try {
      const worker = await createWorkerForRepo(repoDir, "alive-stale-tmux-worker");
      const task = createTaskForRepo(repoDir, { title: "Alive stale visible task", prompt: "Do it visibly" });
      assignTaskForRepo(repoDir, task.taskId, worker.workerId);
      const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId });
      const run = getOrCreateRunForRepo(repoDir);
      writeRun({
        ...run,
        runs: run.runs.map((attempt) =>
          attempt.runId === started.run.runId
            ? {
                ...attempt,
                leaseExpiresAt: "2026-04-27T00:00:00.000Z",
                runtime: {
                  ...attempt.runtime,
                  mode: "tmux",
                  command: "'node' '/tmp/pi-conductor-runner' 'run'",
                  runnerPid: 4242,
                  heartbeatAt: "2026-04-27T00:00:00.000Z",
                  tmux: { socketPath: "/tmp/live-tmux.sock", sessionName: "live", windowId: "@1", paneId: "%2" },
                },
              }
            : attempt,
        ),
      });

      const reconciled = reconcileProjectForRepo(repoDir, { now: "2026-04-27T00:10:00.000Z" });

      expect(reconciled.tasks[0]).toMatchObject({ state: "running", activeRunId: started.run.runId });
      expect(reconciled.workers[0]).toMatchObject({ lifecycle: "running" });
      expect(reconciled.runs[0]).toMatchObject({ status: "running", leaseExpiresAt: null });
      expect(reconciled.runs[0]?.runtime.diagnostics.at(-1)).toMatch(
        /heartbeat stale but runner pid 4242 is still alive/i,
      );
    } finally {
      process.env.PATH = originalPath;
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  it("does not kill tmux sessions from a stale reconciliation snapshot after a fresh heartbeat", async () => {
    const originalPath = process.env.PATH;
    const originalRunFile = process.env.PI_CONDUCTOR_TEST_RUN_FILE;
    const binDir = mkdtempSync(join(tmpdir(), "fake-tmux-bin-"));
    const killMarker = join(binDir, "killed-session");
    process.env.PI_CONDUCTOR_TEST_RUN_FILE = getRunFile(deriveProjectKey(repoDir));
    writeFileSync(
      join(binDir, "tmux"),
      `#!/bin/sh
case "$*" in
  *display-message*)
    node - "$PI_CONDUCTOR_TEST_RUN_FILE" <<'NODE'
const fs = require('node:fs');
const path = process.argv[2];
const data = JSON.parse(fs.readFileSync(path, 'utf-8'));
data.updatedAt = '2026-04-27T00:10:00.123Z';
data.runs = data.runs.map((run) => ({ ...run, runtime: { ...run.runtime, heartbeatAt: '2026-04-27T00:10:00.000Z' } }));
fs.writeFileSync(path, JSON.stringify(data, null, 2) + String.fromCharCode(10));
NODE
    printf 'node\n'
    ;;
  *kill-session*) touch '${killMarker}' ;;
  *) exit 0 ;;
esac
`,
      { mode: 0o755 },
    );
    writeFileSync(join(binDir, "ps"), "#!/bin/sh\nprintf '4242\n'\n", { mode: 0o755 });
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;
    try {
      const worker = await createWorkerForRepo(repoDir, "fresh-heartbeat-worker");
      const task = createTaskForRepo(repoDir, { title: "Fresh heartbeat", prompt: "Do it visibly" });
      assignTaskForRepo(repoDir, task.taskId, worker.workerId);
      const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId });
      const run = getOrCreateRunForRepo(repoDir);
      const aliveDiagnostic = "tmux runner heartbeat stale but runner pid 4242 is still alive";
      writeRun({
        ...run,
        runs: run.runs.map((attempt) =>
          attempt.runId === started.run.runId
            ? {
                ...attempt,
                leaseExpiresAt: "2026-04-27T00:00:00.000Z",
                runtime: {
                  ...attempt.runtime,
                  mode: "tmux",
                  command: "'node' '/tmp/pi-conductor-runner' 'run'",
                  runnerPid: 4242,
                  heartbeatAt: "2026-04-27T00:00:00.000Z",
                  cleanupStatus: "pending",
                  diagnostics: [aliveDiagnostic],
                  tmux: { socketPath: "/tmp/live-tmux.sock", sessionName: "live", windowId: "@1", paneId: "%2" },
                },
              }
            : attempt,
        ),
      });

      const reconciled = reconcileProjectForRepo(repoDir, { now: "2026-04-27T00:10:00.000Z" });

      expect(reconciled.runs[0]).toMatchObject({ status: "running", leaseExpiresAt: null });
      expect(existsSync(killMarker)).toBe(false);
    } finally {
      process.env.PATH = originalPath;
      if (originalRunFile === undefined) delete process.env.PI_CONDUCTOR_TEST_RUN_FILE;
      else process.env.PI_CONDUCTOR_TEST_RUN_FILE = originalRunFile;
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  it("reports reconcile contention instead of returning unpersisted changes", async () => {
    const originalPath = process.env.PATH;
    const originalRunFile = process.env.PI_CONDUCTOR_TEST_RUN_FILE;
    const binDir = mkdtempSync(join(tmpdir(), "fake-tmux-bin-"));
    process.env.PI_CONDUCTOR_TEST_RUN_FILE = getRunFile(deriveProjectKey(repoDir));
    writeFileSync(
      join(binDir, "tmux"),
      `#!/bin/sh
node - "$PI_CONDUCTOR_TEST_RUN_FILE" <<'NODE'
const fs = require('node:fs');
const path = process.argv[2];
const data = JSON.parse(fs.readFileSync(path, 'utf-8'));
data.updatedAt = new Date(Date.now() + Math.floor(Math.random() * 100000)).toISOString();
fs.writeFileSync(path, JSON.stringify(data, null, 2) + String.fromCharCode(10));
NODE
case "$*" in *has-session*) exit 1 ;; *) exit 0 ;; esac
`,
      { mode: 0o755 },
    );
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;
    try {
      const worker = await createWorkerForRepo(repoDir, "contention-worker");
      const task = createTaskForRepo(repoDir, { title: "Contention", prompt: "Do it visibly" });
      assignTaskForRepo(repoDir, task.taskId, worker.workerId);
      const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId });
      const run = getOrCreateRunForRepo(repoDir);
      writeRun({
        ...run,
        runs: run.runs.map((attempt) =>
          attempt.runId === started.run.runId
            ? {
                ...attempt,
                runtime: {
                  ...attempt.runtime,
                  mode: "tmux",
                  tmux: { socketPath: "/tmp/contention.sock", sessionName: "contention", windowId: "@1", paneId: "%2" },
                },
              }
            : attempt,
        ),
      });

      expect(() => reconcileProjectForRepo(repoDir, { now: "2026-04-27T00:00:00.000Z" })).toThrow(
        /concurrent updates/i,
      );
      expect(getOrCreateRunForRepo(repoDir).runs[0]).toMatchObject({ status: "running" });
    } finally {
      process.env.PATH = originalPath;
      if (originalRunFile === undefined) delete process.env.PI_CONDUCTOR_TEST_RUN_FILE;
      else process.env.PI_CONDUCTOR_TEST_RUN_FILE = originalRunFile;
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  it("keeps repeated alive-pid stale heartbeats active without killing tmux", async () => {
    const originalPath = process.env.PATH;
    const binDir = mkdtempSync(join(tmpdir(), "fake-tmux-bin-"));
    const killMarker = join(binDir, "killed-session");
    writeFileSync(
      join(binDir, "tmux"),
      `#!/bin/sh
case "$*" in
  *display-message*) printf 'node\n' ;;
  *kill-session*) touch '${killMarker}' ;;
  *) exit 0 ;;
esac
`,
      { mode: 0o755 },
    );
    writeFileSync(join(binDir, "ps"), "#!/bin/sh\nprintf '4242\n'\n", { mode: 0o755 });
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;
    try {
      const worker = await createWorkerForRepo(repoDir, "repeated-alive-stale-worker");
      const task = createTaskForRepo(repoDir, { title: "Repeated stale", prompt: "Do it visibly" });
      assignTaskForRepo(repoDir, task.taskId, worker.workerId);
      const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId });
      const run = getOrCreateRunForRepo(repoDir);
      const aliveDiagnostic = "tmux runner heartbeat stale but runner pid 4242 is still alive";
      writeRun({
        ...run,
        runs: run.runs.map((attempt) =>
          attempt.runId === started.run.runId
            ? {
                ...attempt,
                leaseExpiresAt: "2026-04-27T00:00:00.000Z",
                runtime: {
                  ...attempt.runtime,
                  mode: "tmux",
                  command: "'node' '/tmp/pi-conductor-runner' 'run'",
                  runnerPid: 4242,
                  heartbeatAt: "2026-04-27T00:00:00.000Z",
                  cleanupStatus: "pending",
                  diagnostics: [aliveDiagnostic],
                  tmux: { socketPath: "/tmp/live-tmux.sock", sessionName: "live", windowId: "@1", paneId: "%2" },
                },
              }
            : attempt,
        ),
      });

      const reconciled = reconcileProjectForRepo(repoDir, { now: "2026-04-27T00:10:00.000Z" });

      expect(reconciled.runs[0]).toMatchObject({ status: "running", runtime: { cleanupStatus: "pending" } });
      expect(reconciled.tasks[0]).toMatchObject({ state: "running", activeRunId: started.run.runId });
      expect(existsSync(killMarker)).toBe(false);

      const rereconciled = reconcileProjectForRepo(repoDir, { now: "2026-04-27T00:11:00.000Z" });

      expect(rereconciled.runs[0]).toMatchObject({ status: "running", runtime: { cleanupStatus: "pending" } });
      expect(existsSync(killMarker)).toBe(false);
    } finally {
      process.env.PATH = originalPath;
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  it("does not make tmux runs immortal when the runner heartbeat is stale", async () => {
    const originalPath = process.env.PATH;
    const binDir = mkdtempSync(join(tmpdir(), "fake-tmux-bin-"));
    writeFileSync(join(binDir, "tmux"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;
    try {
      const worker = await createWorkerForRepo(repoDir, "stale-tmux-worker");
      const task = createTaskForRepo(repoDir, { title: "Stale visible task", prompt: "Do it visibly" });
      assignTaskForRepo(repoDir, task.taskId, worker.workerId);
      const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId });
      const run = getOrCreateRunForRepo(repoDir);
      writeRun({
        ...run,
        runs: run.runs.map((attempt) =>
          attempt.runId === started.run.runId
            ? {
                ...attempt,
                leaseExpiresAt: "2026-04-27T00:00:00.000Z",
                runtime: {
                  ...attempt.runtime,
                  mode: "tmux",
                  heartbeatAt: "2026-04-27T00:00:00.000Z",
                  tmux: { socketPath: "/tmp/live-tmux.sock", sessionName: "live", windowId: "@1", paneId: "%2" },
                },
              }
            : attempt,
        ),
      });

      const reconciled = reconcileProjectForRepo(repoDir, { now: "2026-04-27T00:10:00.000Z" });

      expect(reconciled.tasks[0]).toMatchObject({ state: "needs_review", activeRunId: null });
      expect(reconciled.workers[0]).toMatchObject({ lifecycle: "broken", recoverable: true });
      expect(reconciled.runs[0]).toMatchObject({ status: "stale", errorMessage: expect.stringContaining("heartbeat") });
    } finally {
      process.env.PATH = originalPath;
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  it("records failed cleanup when stale heartbeat tmux cleanup fails", async () => {
    const originalPath = process.env.PATH;
    const binDir = mkdtempSync(join(tmpdir(), "fake-tmux-bin-"));
    writeFileSync(
      join(binDir, "tmux"),
      "#!/bin/sh\ncase \"$*\" in *display-message*) printf 'node\\n' ;; *kill-session*) echo 'permission denied' >&2; exit 2 ;; *) exit 0 ;; esac\n",
      { mode: 0o755 },
    );
    writeFileSync(join(binDir, "ps"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;
    try {
      const worker = await createWorkerForRepo(repoDir, "cleanup-failure-worker");
      const task = createTaskForRepo(repoDir, { title: "Cleanup failure", prompt: "Do it visibly" });
      assignTaskForRepo(repoDir, task.taskId, worker.workerId);
      const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId });
      const run = getOrCreateRunForRepo(repoDir);
      writeRun({
        ...run,
        runs: run.runs.map((attempt) =>
          attempt.runId === started.run.runId
            ? {
                ...attempt,
                runtime: {
                  ...attempt.runtime,
                  mode: "tmux",
                  command: "'node' '/tmp/pi-conductor-runner' 'run'",
                  runnerPid: 4242,
                  heartbeatAt: "2026-04-27T00:00:00.000Z",
                  cleanupStatus: "pending",
                  diagnostics: [],
                  tmux: { socketPath: "/tmp/live-tmux.sock", sessionName: "live", windowId: "@1", paneId: "%2" },
                },
              }
            : attempt,
        ),
      });

      const reconciled = reconcileProjectForRepo(repoDir, { now: "2026-04-27T00:10:00.000Z" });

      expect(reconciled.runs[0]).toMatchObject({ status: "stale", runtime: { cleanupStatus: "failed" } });
      expect(reconciled.runs[0]?.runtime.diagnostics.at(-1)).toMatch(/cleanup failed/i);
    } finally {
      process.env.PATH = originalPath;
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  it("previews tmux stale-session reconciliation without persisting dry runs", async () => {
    const worker = await createWorkerForRepo(repoDir, "tmux-dry-worker");
    const task = createTaskForRepo(repoDir, { title: "Visible dry run", prompt: "Do it visibly" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId });
    const run = getOrCreateRunForRepo(repoDir);
    writeRun({
      ...run,
      runs: run.runs.map((attempt) =>
        attempt.runId === started.run.runId
          ? {
              ...attempt,
              runtime: {
                ...attempt.runtime,
                mode: "tmux",
                tmux: { socketPath: "/tmp/missing-tmux.sock", sessionName: "missing", windowId: "@1", paneId: "%2" },
              },
            }
          : attempt,
      ),
    });

    const preview = reconcileProjectForRepo(repoDir, { now: "2026-04-27T00:00:00.000Z", dryRun: true });
    const persisted = getOrCreateRunForRepo(repoDir);

    expect(preview.tasks[0]).toMatchObject({ state: "needs_review", activeRunId: null });
    expect(persisted.tasks[0]).toMatchObject({ state: "running", activeRunId: started.run.runId });
    expect(persisted.runs[0]).toMatchObject({ status: "running", errorMessage: null });
  });

  it("supports read-only project reconciliation dry runs", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Lease task", prompt: "Do it" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId, leaseSeconds: -1 });

    const preview = reconcileProjectForRepo(repoDir, { now: "2999-01-01T00:00:00.000Z", dryRun: true });

    expect(preview.runs[0]).toMatchObject({ status: "stale" });
    expect(preview.tasks[0]).toMatchObject({ state: "needs_review" });
    const persisted = getOrCreateRunForRepo(repoDir);
    expect(persisted.runs[0]).toMatchObject({ status: "running" });
    expect(persisted.tasks[0]).toMatchObject({ state: "running" });
    expect(persisted.events.map((event) => event.type)).not.toContain("run.lease_expired");
  });

  it("creates a worker, worktree, and persisted worker record", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const worktreePath = requireValue(worker.worktreePath, "worker worktree missing");
    const sessionFile = requireValue(worker.sessionFile, "worker session file missing");
    expect(worker.name).toBe("backend");
    expect(worker.branch).toBe("conductor/backend");
    expect(worker.worktreePath).toBeTruthy();
    expect(existsSync(worktreePath)).toBe(true);
    expect(worker.sessionFile).toBeTruthy();
    expect(existsSync(sessionFile)).toBe(true);
    expect(worker.runtime.backend).toBe("session_manager");
    expect(worker.runtime.sessionId).toBeTruthy();

    const run = getOrCreateRunForRepo(repoDir);
    expect(run.workers).toHaveLength(1);
    expect(run.workers[0]?.name).toBe("backend");
    expect(run.workers[0]?.sessionFile).toBeTruthy();
    expect(run.workers[0]?.runtime.sessionId).toBeTruthy();
  });
});
