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
import type { ItermViewerCommandAdapter } from "../extensions/iterm-viewer.js";
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
      noncePath: "/tmp/contracts/nonce $(x).txt",
      logPath: "/tmp/logs/run log.txt",
    });

    expect(launch.args).toContain("/tmp/socket path/tmux.sock");
    expect(launch.command).toContain("'/tmp/runner'\\''s dir/runner-cli.mjs'");
    expect(launch.command).toContain("'/tmp/contracts/contract $(x).json'");
    expect(launch.command).toContain("'--nonce-file' '/tmp/contracts/nonce $(x).txt'");
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
    expect(launch?.args.at(-1)).not.toContain("abc123def4567890abc123def4567890");

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
    expect(persisted?.runtime.command).toContain("'--nonce-file'");
    expect(persisted?.runtime.tmux?.sessionName).not.toContain("abc123de");
    expect(persisted?.runtime.viewerCommand).not.toContain("abc123de");
    expect(persisted?.runtime.diagnostics.join("\n")).not.toContain("abc123de");
    const contractPath = persisted?.runtime.contractPath;
    expect(contractPath).toBeTruthy();
    const contractContent = readFileSync(contractPath ?? "", "utf-8");
    expect(contractContent).toContain(started.run.runId);
    expect(contractContent).not.toContain("abc123def4567890abc123def4567890");
    expect(existsSync(persisted?.runtime.logPath ?? "")).toBe(true);
    expect(statSync(persisted?.runtime.logPath ?? "").mode & 0o777).toBe(0o600);
  });

  it("opens iTerm2 as a viewer over an iterm-tmux run", async () => {
    const { worker, started } = await createStartedTask();
    const adapter = new FakeTmuxAdapter();
    const itermViewerAdapter: ItermViewerCommandAdapter = { execFile: async () => ({ stdout: "", stderr: "" }) };
    const backend = createTmuxWorkerRunRuntimeBackend({
      mode: "iterm-tmux",
      commandAdapter: adapter,
      runnerCommand: ["node", "/tmp/pi-conductor-runner", "run"],
      itermViewerAdapter,
      itermPlatform: "darwin",
      waitForCompletion: false,
      randomHex: () => "feedfacefeedfacefeedfacefeedface",
      now: () => "2026-04-27T00:00:00.000Z",
    });

    await backend.run({
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

    const persisted = getOrCreateRunForRepo(repoDir).runs[0];
    expect(persisted?.runtime).toMatchObject({
      mode: "iterm-tmux",
      status: "running",
      viewerStatus: "opened",
      viewerCommand: expect.stringContaining("attach-session -r"),
    });
    expect(persisted?.runtime.diagnostics.join("\n")).toContain("iTerm2 viewer opened");
  });

  it("does not tear down tmux when best-effort viewer metadata cannot be persisted", async () => {
    const { worker, started } = await createStartedTask();
    const adapter = new FakeTmuxAdapter();
    const itermViewerAdapter: ItermViewerCommandAdapter = { execFile: async () => ({ stdout: "", stderr: "" }) };
    const backend = createTmuxWorkerRunRuntimeBackend({
      mode: "iterm-tmux",
      commandAdapter: adapter,
      runnerCommand: ["node", "/tmp/pi-conductor-runner", "run"],
      itermViewerAdapter,
      itermPlatform: "darwin",
      waitForCompletion: false,
      randomHex: () => "ba5eba11ba5eba11ba5eba11ba5eba11",
    });

    const result = await backend.run({
      repoRoot: repoDir,
      worktreePath: worker.worktreePath ?? repoDir,
      sessionFile: worker.sessionFile ?? join(repoDir, "session.jsonl"),
      task: "Run in tmux",
      taskContract: started.taskContract,
      onRuntimeMetadata: async (metadata) => {
        if (metadata.viewerStatus === "opened") throw new Error("viewer state lock unavailable");
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

    expect(result).toMatchObject({ status: "success" });
    expect(adapter.calls.some((call) => call.args.includes("kill-session"))).toBe(false);
    expect(getOrCreateRunForRepo(repoDir).runs[0]?.runtime).toMatchObject({
      mode: "iterm-tmux",
      status: "running",
      viewerStatus: "pending",
    });
  });

  it("keeps an iterm-tmux run active when the iTerm2 viewer cannot open", async () => {
    const { worker, started } = await createStartedTask();
    const adapter = new FakeTmuxAdapter();
    const itermViewerAdapter: ItermViewerCommandAdapter = {
      execFile: async () => {
        throw new Error("osascript unavailable");
      },
    };
    const backend = createTmuxWorkerRunRuntimeBackend({
      mode: "iterm-tmux",
      commandAdapter: adapter,
      runnerCommand: ["node", "/tmp/pi-conductor-runner", "run"],
      itermViewerAdapter,
      itermPlatform: "darwin",
      waitForCompletion: false,
      randomHex: () => "cafebabecafebabecafebabecafebabe",
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

    const persisted = getOrCreateRunForRepo(repoDir).runs[0];
    expect(result).toMatchObject({ status: "success" });
    expect(persisted?.runtime).toMatchObject({ mode: "iterm-tmux", status: "running", viewerStatus: "warning" });
    expect(persisted?.runtime.diagnostics.join("\n")).toContain("osascript unavailable");
    expect(adapter.calls.some((call) => call.args.includes("kill-session"))).toBe(false);
  });

  it("does not launch tmux when cancellation is already requested", async () => {
    const { worker, started } = await createStartedTask();
    const adapter = new FakeTmuxAdapter();
    const backend = createTmuxWorkerRunRuntimeBackend({
      commandAdapter: adapter,
      runnerCommand: ["node", "/tmp/pi-conductor-runner", "run"],
      waitForCompletion: false,
      randomHex: () => "00112233445566778899aabbccddeeff",
    });
    const controller = new AbortController();
    controller.abort();

    const result = await backend.run({
      repoRoot: repoDir,
      worktreePath: worker.worktreePath ?? repoDir,
      sessionFile: worker.sessionFile ?? join(repoDir, "session.jsonl"),
      task: "Run in tmux",
      taskContract: started.taskContract,
      signal: controller.signal,
    });

    expect(result).toMatchObject({ status: "aborted" });
    expect(adapter.calls.some((call) => call.args.includes("new-session"))).toBe(false);
  });

  it("cleans up tmux when post-launch metadata persistence fails", async () => {
    const { worker, started } = await createStartedTask();
    const adapter = new FakeTmuxAdapter();
    const backend = createTmuxWorkerRunRuntimeBackend({
      commandAdapter: adapter,
      runnerCommand: ["node", "/tmp/pi-conductor-runner", "run"],
      waitForCompletion: false,
      randomHex: () => "44556677889900aabbccddeeff001122",
    });

    await expect(
      backend.run({
        repoRoot: repoDir,
        worktreePath: worker.worktreePath ?? repoDir,
        sessionFile: worker.sessionFile ?? join(repoDir, "session.jsonl"),
        task: "Run in tmux",
        taskContract: started.taskContract,
        onRuntimeMetadata: async (metadata) => {
          if (metadata.status === "running") throw new Error("state lock unavailable");
        },
      }),
    ).rejects.toThrow(/state lock unavailable/i);

    expect(adapter.calls.some((call) => call.args.includes("new-session"))).toBe(true);
    expect(adapter.calls.some((call) => call.args.includes("kill-session"))).toBe(true);
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

  it("allows explicit runner environment pass-through while keeping other secrets denied", async () => {
    const originalAllowed = process.env.PI_CONDUCTOR_RUNNER_ENV_ALLOWLIST;
    const originalModelKey = process.env.MODEL_API_KEY_FOR_TMUX_TEST;
    const originalSecret = process.env.SECRET_TOKEN_FOR_TMUX_TEST;
    process.env.PI_CONDUCTOR_RUNNER_ENV_ALLOWLIST = "MODEL_API_KEY_FOR_TMUX_TEST";
    process.env.MODEL_API_KEY_FOR_TMUX_TEST = "model-key";
    process.env.SECRET_TOKEN_FOR_TMUX_TEST = "do-not-leak";
    try {
      const { worker, started } = await createStartedTask();
      const adapter = new FakeTmuxAdapter();
      const backend = createTmuxWorkerRunRuntimeBackend({
        commandAdapter: adapter,
        runnerCommand: ["node", "/tmp/pi-conductor-runner", "run"],
        waitForCompletion: false,
        randomHex: () => "abcdefabcdefabcdefabcdefabcdefab",
      });

      await backend.run({
        repoRoot: repoDir,
        worktreePath: worker.worktreePath ?? repoDir,
        sessionFile: worker.sessionFile ?? join(repoDir, "session.jsonl"),
        task: "Run in tmux",
        taskContract: started.taskContract,
      });

      const launch = adapter.calls.find((call) => call.args.includes("new-session"));
      expect(launch?.env).toMatchObject({ MODEL_API_KEY_FOR_TMUX_TEST: "model-key" });
      expect(launch?.env).not.toHaveProperty("SECRET_TOKEN_FOR_TMUX_TEST");
    } finally {
      if (originalAllowed === undefined) delete process.env.PI_CONDUCTOR_RUNNER_ENV_ALLOWLIST;
      else process.env.PI_CONDUCTOR_RUNNER_ENV_ALLOWLIST = originalAllowed;
      if (originalModelKey === undefined) delete process.env.MODEL_API_KEY_FOR_TMUX_TEST;
      else process.env.MODEL_API_KEY_FOR_TMUX_TEST = originalModelKey;
      if (originalSecret === undefined) delete process.env.SECRET_TOKEN_FOR_TMUX_TEST;
      else process.env.SECRET_TOKEN_FOR_TMUX_TEST = originalSecret;
    }
  });

  it("passes common transport credentials to the tmux runner environment", async () => {
    const originalSshAuthSock = process.env.SSH_AUTH_SOCK;
    const originalGhToken = process.env.GH_TOKEN;
    const originalHttpsProxy = process.env.HTTPS_PROXY;
    const originalNoProxy = process.env.NO_PROXY;
    process.env.SSH_AUTH_SOCK = "/tmp/ssh-agent.sock";
    process.env.GH_TOKEN = "github-token";
    process.env.HTTPS_PROXY = "http://proxy.test:8080";
    process.env.NO_PROXY = "localhost,127.0.0.1";
    try {
      const { worker, started } = await createStartedTask();
      const adapter = new FakeTmuxAdapter();
      const backend = createTmuxWorkerRunRuntimeBackend({
        commandAdapter: adapter,
        runnerCommand: ["node", "/tmp/pi-conductor-runner", "run"],
        waitForCompletion: false,
        randomHex: () => "facefeedfacefeedfacefeedfacefeed",
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
        SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
        GH_TOKEN: "github-token",
        HTTPS_PROXY: "http://proxy.test:8080",
        NO_PROXY: "localhost,127.0.0.1",
      });
    } finally {
      if (originalSshAuthSock === undefined) delete process.env.SSH_AUTH_SOCK;
      else process.env.SSH_AUTH_SOCK = originalSshAuthSock;
      if (originalGhToken === undefined) delete process.env.GH_TOKEN;
      else process.env.GH_TOKEN = originalGhToken;
      if (originalHttpsProxy === undefined) delete process.env.HTTPS_PROXY;
      else process.env.HTTPS_PROXY = originalHttpsProxy;
      if (originalNoProxy === undefined) delete process.env.NO_PROXY;
      else process.env.NO_PROXY = originalNoProxy;
    }
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

  it("waits for blocked durable completion from the detached runner", async () => {
    const { worker, task, started } = await createStartedTask();
    const adapter = new FakeTmuxAdapter();
    const originalExecFile = adapter.execFile.bind(adapter);
    adapter.execFile = async (command, args, options) => {
      const result = await originalExecFile(command, args, options);
      if (args.includes("new-session")) {
        setTimeout(async () => {
          const { recordTaskCompletionForRepo } = await import("../extensions/task-service.js");
          recordTaskCompletionForRepo(repoDir, {
            runId: started.run.runId,
            taskId: task.taskId,
            status: "blocked",
            completionSummary: "needs input from tmux runner",
          });
        }, 0);
      }
      return result;
    };
    const backend = createTmuxWorkerRunRuntimeBackend({
      commandAdapter: adapter,
      runnerCommand: ["node", "/tmp/pi-conductor-runner", "run"],
      pollIntervalMs: 1,
      randomHex: () => "0102030405060708090a0b0c0d0e0f10",
    });

    const result = await backend.run({
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

    expect(result).toMatchObject({ status: "success", finalText: "needs input from tmux runner" });
    expect(adapter.calls.some((call) => call.args.includes("kill-session"))).toBe(true);
    expect(getOrCreateRunForRepo(repoDir).workers[0]).toMatchObject({ lifecycle: "idle", recoverable: false });
  });

  it("returns promptly when the launched tmux session disappears before completion", async () => {
    const { worker, started } = await createStartedTask();
    const adapter = new FakeTmuxAdapter();
    const originalExecFile = adapter.execFile.bind(adapter);
    adapter.execFile = async (command, args, options) => {
      const result = await originalExecFile(command, args, options);
      if (args.includes("new-session")) adapter.failHasSession = true;
      return result;
    };
    const backend = createTmuxWorkerRunRuntimeBackend({
      commandAdapter: adapter,
      runnerCommand: ["node", "/tmp/pi-conductor-runner", "run"],
      pollIntervalMs: 1,
      randomHex: () => "99887766554433221100ffeeddccbbaa",
    });
    const controller = new AbortController();

    const result = await Promise.race([
      backend.run({
        repoRoot: repoDir,
        worktreePath: worker.worktreePath ?? repoDir,
        sessionFile: worker.sessionFile ?? join(repoDir, "session.jsonl"),
        task: "Run in tmux",
        taskContract: started.taskContract,
        signal: controller.signal,
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
      }),
      new Promise<"timeout">((resolve) =>
        setTimeout(() => {
          controller.abort();
          resolve("timeout");
        }, 50),
      ),
    ]);

    expect(result).not.toBe("timeout");
    expect(result).toMatchObject({ status: "error", errorMessage: expect.stringContaining("tmux") });
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

  it("fails closed without killing when pane command verification cannot run", async () => {
    const adapter = new FakeTmuxAdapter();
    const originalExecFile = adapter.execFile.bind(adapter);
    adapter.execFile = async (command, args, options) => {
      if (args.includes("display-message") && args.includes("#{pane_current_command}")) {
        throw new Error("stale pane id");
      }
      return originalExecFile(command, args, options);
    };
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
      tmux: { socketPath: "/tmp/tmux.sock", sessionName: "owned", windowId: null, paneId: "%stale" },
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
      diagnostic: expect.stringContaining("pane command verification failed"),
    });
    expect(adapter.calls.some((call) => call.args.includes("kill-session"))).toBe(false);
  });

  it("fails closed without killing when pane command verification differs", async () => {
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

  it("reports generic tmux kill failures as failed cleanup", async () => {
    const adapter = new FakeTmuxAdapter();
    const originalExecFile = adapter.execFile.bind(adapter);
    adapter.execFile = async (command, args, options) => {
      if (args.includes("kill-session")) throw new Error("permission denied");
      return originalExecFile(command, args, options);
    };
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
      tmux: { socketPath: "/tmp/tmux.sock", sessionName: "denied", windowId: null, paneId: null },
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
      diagnostic: expect.stringContaining("permission denied"),
    });
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

  it("does not mark a concurrently completed run stale during tmux reconciliation", async () => {
    const { worker, task, started } = await createStartedTask();
    const adapter = new FakeTmuxAdapter();
    const backend = createTmuxWorkerRunRuntimeBackend({
      commandAdapter: adapter,
      runnerCommand: ["node", "/tmp/pi-conductor-runner", "run"],
      waitForCompletion: false,
      randomHex: () => "12121212121212121212121212121212",
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
    const originalExecFile = adapter.execFile.bind(adapter);
    adapter.execFile = async (command, args, options) => {
      if (args.includes("has-session")) {
        const { recordTaskCompletionForRepo } = await import("../extensions/task-service.js");
        recordTaskCompletionForRepo(repoDir, {
          runId: started.run.runId,
          taskId: task.taskId,
          status: "succeeded",
          completionSummary: "completed concurrently",
        });
      }
      return originalExecFile(command, args, options);
    };

    const reconciled = await reconcileTmuxRuntimeForRepo({ repoRoot: repoDir, runId: started.run.runId, adapter });

    expect(reconciled.runs[0]).toMatchObject({ status: "succeeded", completionSummary: "completed concurrently" });
    expect(reconciled.tasks[0]).toMatchObject({ state: "completed", activeRunId: null });
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

    const secondReconciled = await reconcileTmuxRuntimeForRepo({
      repoRoot: repoDir,
      runId: started.run.runId,
      adapter,
      now: "2026-04-27T00:06:00.000Z",
      staleHeartbeatMs: 60_000,
    });
    expect(secondReconciled.tasks[0]).toMatchObject({ state: "running", activeRunId: started.run.runId });
    expect(secondReconciled.runs[0]).toMatchObject({ status: "running", finishedAt: null });
    expect(adapter.calls.some((call) => call.args.includes("kill-session"))).toBe(false);
  });

  it("does not kill a tmux session from a stale heartbeat snapshot after a fresh heartbeat", async () => {
    const { worker, started } = await createStartedTask();
    const adapter = new FakeTmuxAdapter();
    const backend = createTmuxWorkerRunRuntimeBackend({
      commandAdapter: adapter,
      runnerCommand: ["node", "/tmp/pi-conductor-runner", "run"],
      waitForCompletion: false,
      randomHex: () => "d00dd00dd00dd00dd00dd00dd00dd00d",
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
    const latest = getOrCreateRunForRepo(repoDir);
    const staleDiagnostic = "tmux runner heartbeat stale but runner pid 4242 is still alive";
    const { writeRun } = await import("../extensions/storage.js");
    writeRun({
      ...latest,
      runs: latest.runs.map((entry) =>
        entry.runId === started.run.runId
          ? {
              ...entry,
              runtime: { ...entry.runtime, heartbeatAt: "2026-04-27T00:00:00.000Z", diagnostics: [staleDiagnostic] },
            }
          : entry,
      ),
    });
    const originalExecFile = adapter.execFile.bind(adapter);
    adapter.execFile = async (command, args, options) => {
      if (command === "ps") {
        const current = getOrCreateRunForRepo(repoDir);
        writeRun({
          ...current,
          runs: current.runs.map((entry) =>
            entry.runId === started.run.runId
              ? { ...entry, runtime: { ...entry.runtime, heartbeatAt: "2026-04-27T00:10:00.000Z" } }
              : entry,
          ),
        });
      }
      return originalExecFile(command, args, options);
    };

    const reconciled = await reconcileTmuxRuntimeForRepo({
      repoRoot: repoDir,
      runId: started.run.runId,
      adapter,
      now: "2026-04-27T00:10:00.000Z",
      staleHeartbeatMs: 60_000,
    });

    expect(reconciled.runs[0]).toMatchObject({ status: "running" });
    expect(adapter.calls.some((call) => call.args.includes("kill-session"))).toBe(false);
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
