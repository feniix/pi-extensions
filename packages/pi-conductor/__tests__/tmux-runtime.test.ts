import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assignTaskForRepo,
  createTaskForRepo,
  createWorkerForRepo,
  getOrCreateRunForRepo,
  startTaskRunForRepo,
} from "../extensions/conductor.js";
import {
  buildTmuxLaunch,
  cancelTmuxRuntime,
  createTmuxWorkerRunRuntimeBackend,
  reconcileTmuxRuntimeForRepo,
  shellQuote,
  type TmuxCommandAdapter,
} from "../extensions/tmux-runtime.js";
import type { RunRuntimeMetadata } from "../extensions/types.js";

class FakeTmuxAdapter implements TmuxCommandAdapter {
  calls: Array<{ command: string; args: string[]; cwd?: string; env?: NodeJS.ProcessEnv }> = [];
  failHasSession = false;
  failKill = false;
  failPs = false;
  replacedPaneCommand = false;

  async execFile(command: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }) {
    this.calls.push({ command, args, cwd: options?.cwd, env: options?.env });
    if (args.includes("has-session") && this.failHasSession) {
      throw new Error("can't find session: missing");
    }
    if (args.includes("kill-session") && this.failKill) {
      throw new Error("can't find session: missing");
    }
    if (args.includes("display-message") && args.includes("#{pane_current_command}")) {
      return { stdout: this.replacedPaneCommand ? "zsh\n" : "node\n", stderr: "" };
    }
    if (args.includes("display-message")) {
      return { stdout: "@42 %7 4242\n", stderr: "" };
    }
    if (command === "ps") {
      if (this.failPs) {
        throw new Error("process not found");
      }
      return { stdout: args.includes("pgid=") ? "4240\n" : "4242\n", stderr: "" };
    }
    return { stdout: command === "tmux" && args[0] === "-V" ? "tmux 3.4" : "", stderr: "" };
  }
}

describe("tmux conductor runtime", () => {
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

  async function createStartedTask() {
    const worker = await createWorkerForRepo(repoDir, "tmux-worker");
    const task = createTaskForRepo(repoDir, { title: "Tmux task", prompt: "Run in tmux" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId });
    return { worker, task, started };
  }

  it("quotes tmux shell commands through one adapter boundary", () => {
    expect(shellQuote("simple")).toBe("'simple'");
    expect(shellQuote("has ' quote; $(rm -rf nope)\nnext")).toBe("'has '\\'' quote; $(rm -rf nope)\nnext'");

    const launch = buildTmuxLaunch({
      tmuxSocketPath: "/tmp/socket path/tmux.sock",
      sessionName: "session;name",
      worktreePath: "/tmp/work tree",
      runnerCommand: ["/usr/bin/node", "/tmp/runner's dir/runner-cli.mjs", "run"],
      contractPath: "/tmp/contracts/contract $(x).json",
      nonce: "nonce;with;semicolons",
      logPath: "/tmp/logs/run log.txt",
    });

    expect(launch.args).toContain("/tmp/socket path/tmux.sock");
    expect(launch.command).toContain("'/tmp/runner'\\''s dir/runner-cli.mjs'");
    expect(launch.command).toContain("'/tmp/contracts/contract $(x).json'");
    expect(launch.command).toContain(">> '/tmp/logs/run log.txt' 2>&1");
    expect(launch.args.at(-1)).toBe(launch.command);
  });

  it("launches tmux with a persisted runner contract and runtime metadata", async () => {
    const { worker, started } = await createStartedTask();
    const adapter = new FakeTmuxAdapter();
    const backend = createTmuxWorkerRunRuntimeBackend({
      commandAdapter: adapter,
      runnerCommand: ["node", "/tmp/pi-conductor-runner", "run"],
      waitForCompletion: false,
      randomHex: () => "abc123def4567890abc123def4567890",
      now: () => "2026-04-27T00:00:00.000Z",
    });

    const result = await backend.run({
      repoRoot: repoDir,
      worktreePath: worker.worktreePath ?? repoDir,
      sessionFile: worker.sessionFile ?? join(repoDir, "session.jsonl"),
      task: "Run in tmux",
      taskContract: started.taskContract,
      onRuntimeMetadata: async (metadata) => {
        const now = "2026-04-27T00:00:01.000Z";
        const latest = getOrCreateRunForRepo(repoDir);
        const updated = {
          ...latest,
          runs: latest.runs.map((entry) =>
            entry.runId === started.run.runId
              ? { ...entry, runtime: { ...entry.runtime, ...metadata }, updatedAt: now }
              : entry,
          ),
        };
        const { writeRun } = await import("../extensions/storage.js");
        writeRun(updated);
      },
    });

    expect(result).toMatchObject({ status: "success", sessionId: expect.stringContaining("pi-cond-") });
    const launch = adapter.calls.find((call) => call.args.includes("new-session"));
    expect(launch).toBeTruthy();
    expect(launch?.cwd).toBe(worker.worktreePath);
    expect(launch?.args).toContain("-S");
    expect(launch?.args.at(-1)).toContain("--contract");

    const persisted = getOrCreateRunForRepo(repoDir).runs[0];
    expect(persisted?.runtime).toMatchObject({
      mode: "tmux",
      status: "running",
      runnerPid: 4242,
      processGroupId: 4240,
      tmux: { sessionName: expect.stringContaining(started.run.runId.slice(0, 32)), windowId: "@42", paneId: "%7" },
      logPath: expect.stringContaining("runner.log"),
      viewerCommand: expect.stringContaining("attach-session -r"),
    });
    expect(persisted?.runtime.command).not.toContain("abc123def4567890abc123def4567890");
    expect(persisted?.runtime.command).not.toContain("abc123de");
    expect(persisted?.runtime.command).toContain("'--nonce' <redacted>");
    expect(persisted?.runtime.tmux?.sessionName).not.toContain("abc123de");
    expect(persisted?.runtime.viewerCommand).not.toContain("abc123de");
    expect(persisted?.runtime.diagnostics.join("\n")).not.toContain("abc123de");
    const contractPath = persisted?.runtime.contractPath;
    expect(contractPath).toBeTruthy();
    expect(readFileSync(contractPath ?? "", "utf-8")).toContain(started.run.runId);
    expect(existsSync(persisted?.runtime.logPath ?? "")).toBe(true);
    expect(statSync(persisted?.runtime.logPath ?? "").mode & 0o777).toBe(0o600);
  });

  it("cleans up tmux when durable cancellation wins the launch race", async () => {
    const { worker, started } = await createStartedTask();
    const adapter = new FakeTmuxAdapter();
    const originalExecFile = adapter.execFile.bind(adapter);
    adapter.execFile = async (command, args, options) => {
      const result = await originalExecFile(command, args, options);
      if (args.includes("new-session")) {
        const { cancelTaskRunForRepo: cancelTaskRunStateForRepo } = await import("../extensions/task-service.js");
        cancelTaskRunStateForRepo(repoDir, { runId: started.run.runId, reason: "human canceled during launch" });
      }
      return result;
    };
    const backend = createTmuxWorkerRunRuntimeBackend({
      commandAdapter: adapter,
      runnerCommand: ["node", "/tmp/pi-conductor-runner", "run"],
      waitForCompletion: false,
      randomHex: () => "11223344556677889900aabbccddeeff",
    });

    const result = await backend.run({
      repoRoot: repoDir,
      worktreePath: worker.worktreePath ?? repoDir,
      sessionFile: worker.sessionFile ?? join(repoDir, "session.jsonl"),
      task: "Run in tmux",
      taskContract: started.taskContract,
      onRuntimeMetadata: async (metadata) => {
        const latest = getOrCreateRunForRepo(repoDir);
        const { writeRun } = await import("../extensions/storage.js");
        writeRun({
          ...latest,
          runs: latest.runs.map((entry) =>
            entry.runId === started.run.runId ? { ...entry, runtime: { ...entry.runtime, ...metadata } } : entry,
          ),
        });
      },
    });

    expect(result).toMatchObject({ status: "aborted" });
    expect(adapter.calls.some((call) => call.args.includes("kill-session"))).toBe(true);
  });

  it("launches tmux with a sanitized runner environment", async () => {
    const originalSecret = process.env.SECRET_TOKEN_FOR_TMUX_TEST;
    process.env.SECRET_TOKEN_FOR_TMUX_TEST = "do-not-leak";
    try {
      const { worker, started } = await createStartedTask();
      const adapter = new FakeTmuxAdapter();
      const backend = createTmuxWorkerRunRuntimeBackend({
        commandAdapter: adapter,
        runnerCommand: ["node", "/tmp/pi-conductor-runner", "run"],
        waitForCompletion: false,
        randomHex: () => "feedfacefeedfacefeedfacefeedface",
      });

      await backend.run({
        repoRoot: repoDir,
        worktreePath: worker.worktreePath ?? repoDir,
        sessionFile: worker.sessionFile ?? join(repoDir, "session.jsonl"),
        task: "Run in tmux",
        taskContract: started.taskContract,
      });

      const launch = adapter.calls.find((call) => call.args.includes("new-session"));
      expect(launch?.env).toMatchObject({
        PATH: expect.any(String),
        HOME: expect.any(String),
        PI_CONDUCTOR_HOME: conductorHome,
      });
      expect(launch?.env).not.toHaveProperty("SECRET_TOKEN_FOR_TMUX_TEST");
    } finally {
      if (originalSecret === undefined) {
        delete process.env.SECRET_TOKEN_FOR_TMUX_TEST;
      } else {
        process.env.SECRET_TOKEN_FOR_TMUX_TEST = originalSecret;
      }
    }
  });

  it("persists cleanup metadata when an active tmux run is aborted", async () => {
    const { worker, started } = await createStartedTask();
    const adapter = new FakeTmuxAdapter();
    const metadataUpdates: Array<Partial<RunRuntimeMetadata>> = [];
    const controller = new AbortController();
    const originalExecFile = adapter.execFile.bind(adapter);
    adapter.execFile = async (command, args, options) => {
      const result = await originalExecFile(command, args, options);
      if (args.includes("new-session")) {
        setTimeout(() => controller.abort(), 0);
      }
      return result;
    };
    const backend = createTmuxWorkerRunRuntimeBackend({
      commandAdapter: adapter,
      runnerCommand: ["node", "/tmp/pi-conductor-runner", "run"],
      pollIntervalMs: 1,
      randomHex: () => "decafbaddecafbaddecafbaddecafbad",
    });

    const result = await backend.run({
      repoRoot: repoDir,
      worktreePath: worker.worktreePath ?? repoDir,
      sessionFile: worker.sessionFile ?? join(repoDir, "session.jsonl"),
      task: "Run in tmux",
      taskContract: started.taskContract,
      signal: controller.signal,
      onRuntimeMetadata: async (metadata) => {
        metadataUpdates.push(metadata);
      },
    });

    expect(result.status).toBe("aborted");
    expect(adapter.calls.some((call) => call.args.includes("kill-session"))).toBe(true);
    expect(metadataUpdates).toEqual(expect.arrayContaining([expect.objectContaining({ cleanupStatus: "succeeded" })]));
  });

  it("does not kill a tmux session when pane command verification fails", async () => {
    const adapter = new FakeTmuxAdapter();
    adapter.replacedPaneCommand = true;
    const runtime: RunRuntimeMetadata = {
      mode: "tmux",
      status: "running",
      sessionId: null,
      cwd: repoDir,
      command: "'node' '/tmp/pi-conductor-runner' 'run'",
      contractPath: null,
      nonceHash: null,
      runnerPid: null,
      processGroupId: null,
      tmux: { socketPath: "/tmp/tmux.sock", sessionName: "owned", windowId: null, paneId: "%7" },
      logPath: null,
      viewerCommand: null,
      viewerStatus: "pending",
      diagnostics: [],
      heartbeatAt: null,
      cleanupStatus: "pending",
      startedAt: null,
      finishedAt: null,
    };

    await expect(cancelTmuxRuntime({ adapter, runtime })).resolves.toMatchObject({
      cleanupStatus: "failed",
      diagnostic: expect.stringContaining("pane command"),
    });
    expect(adapter.calls.some((call) => call.args.includes("kill-session"))).toBe(false);
  });

  it("treats tmux cancellation as idempotent when the session is already gone", async () => {
    const adapter = new FakeTmuxAdapter();
    adapter.failKill = true;
    const runtime: RunRuntimeMetadata = {
      mode: "tmux",
      status: "running",
      sessionId: null,
      cwd: repoDir,
      command: null,
      contractPath: null,
      nonceHash: null,
      runnerPid: null,
      processGroupId: null,
      tmux: { socketPath: "/tmp/tmux.sock", sessionName: "missing", windowId: null, paneId: null },
      logPath: null,
      viewerCommand: null,
      viewerStatus: "pending",
      diagnostics: [],
      heartbeatAt: null,
      cleanupStatus: "pending",
      startedAt: null,
      finishedAt: null,
    };

    await expect(cancelTmuxRuntime({ adapter, runtime })).resolves.toMatchObject({ cleanupStatus: "succeeded" });
  });

  it("records missing log diagnostics without making a healthy tmux session terminal", async () => {
    const { worker, started } = await createStartedTask();
    const adapter = new FakeTmuxAdapter();
    const backend = createTmuxWorkerRunRuntimeBackend({
      commandAdapter: adapter,
      runnerCommand: ["node", "/tmp/pi-conductor-runner", "run"],
      waitForCompletion: false,
      randomHex: () => "badc0ffeebadc0ffeebadc0ffeebadc0f",
    });
    await backend.run({
      repoRoot: repoDir,
      worktreePath: worker.worktreePath ?? repoDir,
      sessionFile: worker.sessionFile ?? join(repoDir, "session.jsonl"),
      task: "Run in tmux",
      taskContract: started.taskContract,
      onRuntimeMetadata: async (metadata) => {
        const { writeRun } = await import("../extensions/storage.js");
        const latest = getOrCreateRunForRepo(repoDir);
        writeRun({
          ...latest,
          runs: latest.runs.map((entry) =>
            entry.runId === started.run.runId ? { ...entry, runtime: { ...entry.runtime, ...metadata } } : entry,
          ),
        });
      },
    });
    const logPath = getOrCreateRunForRepo(repoDir).runs[0]?.runtime.logPath;
    if (logPath) rmSync(logPath, { force: true });

    const reconciled = await reconcileTmuxRuntimeForRepo({
      repoRoot: repoDir,
      runId: started.run.runId,
      adapter,
      now: "2026-04-27T00:00:00.000Z",
    });

    expect(reconciled.tasks[0]).toMatchObject({ state: "running", activeRunId: started.run.runId });
    expect(reconciled.runs[0]).toMatchObject({ status: "running", finishedAt: null });
    expect(reconciled.runs[0]?.runtime.diagnostics.at(-1)).toMatch(/log path missing/i);
  });

  it("records stale heartbeat as diagnostic while the runner pid is still alive", async () => {
    const { worker, started } = await createStartedTask();
    const adapter = new FakeTmuxAdapter();
    const backend = createTmuxWorkerRunRuntimeBackend({
      commandAdapter: adapter,
      runnerCommand: ["node", "/tmp/pi-conductor-runner", "run"],
      waitForCompletion: false,
      randomHex: () => "cafebabecafebabecafebabecafebabe",
      now: () => "2026-04-27T00:00:00.000Z",
    });
    await backend.run({
      repoRoot: repoDir,
      worktreePath: worker.worktreePath ?? repoDir,
      sessionFile: worker.sessionFile ?? join(repoDir, "session.jsonl"),
      task: "Run in tmux",
      taskContract: started.taskContract,
      onRuntimeMetadata: async (metadata) => {
        const { writeRun } = await import("../extensions/storage.js");
        const latest = getOrCreateRunForRepo(repoDir);
        writeRun({
          ...latest,
          runs: latest.runs.map((entry) =>
            entry.runId === started.run.runId ? { ...entry, runtime: { ...entry.runtime, ...metadata } } : entry,
          ),
        });
      },
    });
    const logPath = getOrCreateRunForRepo(repoDir).runs[0]?.runtime.logPath;
    writeFileSync(logPath ?? join(repoDir, "missing-log-path"), "runner output\n", "utf-8");

    const reconciled = await reconcileTmuxRuntimeForRepo({
      repoRoot: repoDir,
      runId: started.run.runId,
      adapter,
      now: "2026-04-27T00:05:00.000Z",
      staleHeartbeatMs: 60_000,
    });

    expect(reconciled.tasks[0]).toMatchObject({ state: "running", activeRunId: started.run.runId });
    expect(reconciled.runs[0]).toMatchObject({ status: "running", finishedAt: null });
    expect(reconciled.runs[0]?.runtime.diagnostics.at(-1)).toMatch(/heartbeat stale/i);
  });

  it("reconciles stale heartbeat with a missing runner pid to needs-review", async () => {
    const { worker, started } = await createStartedTask();
    const adapter = new FakeTmuxAdapter();
    const backend = createTmuxWorkerRunRuntimeBackend({
      commandAdapter: adapter,
      runnerCommand: ["node", "/tmp/pi-conductor-runner", "run"],
      waitForCompletion: false,
      randomHex: () => "abcddcbaabcddcbaabcddcbaabcddcba",
      now: () => "2026-04-27T00:00:00.000Z",
    });
    await backend.run({
      repoRoot: repoDir,
      worktreePath: worker.worktreePath ?? repoDir,
      sessionFile: worker.sessionFile ?? join(repoDir, "session.jsonl"),
      task: "Run in tmux",
      taskContract: started.taskContract,
      onRuntimeMetadata: async (metadata) => {
        const { writeRun } = await import("../extensions/storage.js");
        const latest = getOrCreateRunForRepo(repoDir);
        writeRun({
          ...latest,
          runs: latest.runs.map((entry) =>
            entry.runId === started.run.runId ? { ...entry, runtime: { ...entry.runtime, ...metadata } } : entry,
          ),
        });
      },
    });
    const logPath = getOrCreateRunForRepo(repoDir).runs[0]?.runtime.logPath;
    writeFileSync(logPath ?? join(repoDir, "missing-log-path"), "runner output\n", "utf-8");
    adapter.failPs = true;

    const reconciled = await reconcileTmuxRuntimeForRepo({
      repoRoot: repoDir,
      runId: started.run.runId,
      adapter,
      now: "2026-04-27T00:05:00.000Z",
      staleHeartbeatMs: 60_000,
    });

    expect(reconciled.tasks[0]).toMatchObject({ state: "needs_review", activeRunId: null });
    expect(reconciled.workers[0]).toMatchObject({ lifecycle: "broken", recoverable: true });
    expect(reconciled.runs[0]).toMatchObject({ status: "stale", errorMessage: expect.stringContaining("runner pid") });
    expect(reconciled.runs[0]?.runtime.status).toBe("exited_error");
  });

  it("reconciles a replaced tmux pane command to needs-review", async () => {
    const { worker, started } = await createStartedTask();
    const adapter = new FakeTmuxAdapter();
    const backend = createTmuxWorkerRunRuntimeBackend({
      commandAdapter: adapter,
      runnerCommand: ["node", "/tmp/pi-conductor-runner", "run"],
      waitForCompletion: false,
      randomHex: () => "f00df00df00df00df00df00df00df00d",
    });
    await backend.run({
      repoRoot: repoDir,
      worktreePath: worker.worktreePath ?? repoDir,
      sessionFile: worker.sessionFile ?? join(repoDir, "session.jsonl"),
      task: "Run in tmux",
      taskContract: started.taskContract,
      onRuntimeMetadata: async (metadata) => {
        const { writeRun } = await import("../extensions/storage.js");
        const latest = getOrCreateRunForRepo(repoDir);
        writeRun({
          ...latest,
          runs: latest.runs.map((entry) =>
            entry.runId === started.run.runId ? { ...entry, runtime: { ...entry.runtime, ...metadata } } : entry,
          ),
        });
      },
    });
    const logPath = getOrCreateRunForRepo(repoDir).runs[0]?.runtime.logPath;
    writeFileSync(logPath ?? join(repoDir, "missing-log-path"), "runner output\n", "utf-8");
    adapter.replacedPaneCommand = true;

    const reconciled = await reconcileTmuxRuntimeForRepo({
      repoRoot: repoDir,
      runId: started.run.runId,
      adapter,
      now: "2026-04-27T00:00:00.000Z",
    });

    expect(reconciled.tasks[0]).toMatchObject({ state: "needs_review", activeRunId: null });
    expect(reconciled.workers[0]).toMatchObject({ lifecycle: "broken", recoverable: true });
    expect(reconciled.runs[0]).toMatchObject({
      status: "stale",
      errorMessage: expect.stringContaining("pane command"),
    });
  });

  it("reconciles a missing tmux session to stale needs-review without inventing success", async () => {
    const { worker, started } = await createStartedTask();
    const adapter = new FakeTmuxAdapter();
    const backend = createTmuxWorkerRunRuntimeBackend({
      commandAdapter: adapter,
      runnerCommand: ["node", "/tmp/pi-conductor-runner", "run"],
      waitForCompletion: false,
      randomHex: () => "abc123def4567890abc123def4567890",
    });
    await backend.run({
      repoRoot: repoDir,
      worktreePath: worker.worktreePath ?? repoDir,
      sessionFile: worker.sessionFile ?? join(repoDir, "session.jsonl"),
      task: "Run in tmux",
      taskContract: started.taskContract,
      onRuntimeMetadata: async (metadata) => {
        const { writeRun } = await import("../extensions/storage.js");
        const latest = getOrCreateRunForRepo(repoDir);
        writeRun({
          ...latest,
          runs: latest.runs.map((entry) =>
            entry.runId === started.run.runId ? { ...entry, runtime: { ...entry.runtime, ...metadata } } : entry,
          ),
        });
      },
    });
    adapter.failHasSession = true;

    const reconciled = await reconcileTmuxRuntimeForRepo({
      repoRoot: repoDir,
      runId: started.run.runId,
      adapter,
      now: "2026-04-27T00:00:00.000Z",
    });

    expect(reconciled.tasks[0]).toMatchObject({ state: "needs_review", activeRunId: null });
    expect(reconciled.runs[0]).toMatchObject({ status: "stale", errorMessage: expect.stringContaining("missing") });
    expect(reconciled.runs[0]?.runtime.status).toBe("exited_error");
  });
});
