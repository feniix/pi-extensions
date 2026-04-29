import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatActiveWorkerViewerSummary,
  summarizeActiveWorkerViewersForRepo,
} from "../extensions/active-worker-viewer.js";
import {
  assignTaskForRepo,
  createTaskForRepo,
  createWorkerForRepo,
  getOrCreateRunForRepo,
  startTaskRunForRepo,
} from "../extensions/conductor.js";
import conductorExtension from "../extensions/index.js";
import { createRunRuntimeMetadata } from "../extensions/runtime-metadata.js";
import { writeRun } from "../extensions/storage.js";

type RegisteredTool = {
  name: string;
  execute?: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: { cwd: string },
  ) => Promise<unknown> | unknown;
};

function collectTools(): RegisteredTool[] {
  const tools: RegisteredTool[] = [];
  conductorExtension({
    registerCommand: () => undefined,
    registerTool: (tool: RegisteredTool) => tools.push(tool),
  } as never);
  return tools;
}

describe("active worker viewer summaries", () => {
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

  it("lists active supervised worker attach, log, status, and cancel details", async () => {
    const worker = await createWorkerForRepo(repoDir, "viewer-worker");
    const task = createTaskForRepo(repoDir, { title: "Visible | task", prompt: "Watch me" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, runtimeMode: "iterm-tmux" });
    const run = getOrCreateRunForRepo(repoDir);
    writeRun({
      ...run,
      tasks: run.tasks.map((entry) =>
        entry.taskId === task.taskId ? { ...entry, latestProgress: "line one\nline | two" } : entry,
      ),
      runs: run.runs.map((entry) =>
        entry.runId === started.run.runId
          ? {
              ...entry,
              runtime: {
                ...createRunRuntimeMetadata({ mode: "iterm-tmux", status: "running" }),
                viewerStatus: "opened" as const,
                viewerCommand: "tmux -S '/tmp/tmux.sock' attach-session -r -t 'pi-cond-run'",
                logPath: "/tmp/pi-conductor/runtime/run-1/runner.log",
                diagnostics: ["iTerm2 viewer opened"],
              },
            }
          : entry,
      ),
    });

    const summary = summarizeActiveWorkerViewersForRepo(repoDir);

    expect(summary.entries).toHaveLength(1);
    expect(summary.entries[0]).toMatchObject({
      workerName: "viewer-worker",
      taskTitle: "Visible | task",
      runId: started.run.runId,
      runtimeMode: "iterm-tmux",
      runtimeStatus: "running",
      viewerStatus: "opened",
      attachCommand: "tmux -S '/tmp/tmux.sock' attach-session -r -t 'pi-cond-run'",
      logTailCommand: "tail -f '/tmp/pi-conductor/runtime/run-1/runner.log'",
      latestProgress: "line one\nline | two",
      diagnostic: "iTerm2 viewer opened",
    });
    expect(summary.entries[0]?.cancelTool).toEqual({
      name: "conductor_cancel_task_run",
      params: { runId: started.run.runId, reason: "Parent requested cancellation" },
    });

    const markdown = formatActiveWorkerViewerSummary(summary);
    expect(markdown).toContain("active supervised conductor workers: 1");
    expect(markdown).toContain("Visible \\| task");
    expect(markdown).toContain("line one<br>line \\| two");
    expect(markdown).toContain("iTerm2 viewer opened");
  });

  it("falls back to tmux attach instructions when viewer command is unavailable", async () => {
    const worker = await createWorkerForRepo(repoDir, "tmux-worker");
    const task = createTaskForRepo(repoDir, { title: "Tmux task", prompt: "Watch me" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, runtimeMode: "tmux" });
    const run = getOrCreateRunForRepo(repoDir);
    writeRun({
      ...run,
      runs: run.runs.map((entry) =>
        entry.runId === started.run.runId
          ? {
              ...entry,
              runtime: {
                ...createRunRuntimeMetadata({ mode: "tmux", status: "running" }),
                viewerStatus: "unavailable" as const,
                tmux: {
                  socketPath: "/tmp/with space/tmux.sock",
                  sessionName: "pi cond run",
                  windowId: null,
                  paneId: null,
                },
                logPath: null,
                diagnostics: ["iTerm2 unavailable"],
              },
            }
          : entry,
      ),
    });

    const summary = summarizeActiveWorkerViewersForRepo(repoDir, { runId: started.run.runId });

    expect(summary.entries).toHaveLength(1);
    expect(summary.entries[0]?.viewerStatus).toBe("unavailable");
    expect(summary.entries[0]?.attachCommand).toBe(
      "tmux -S '/tmp/with space/tmux.sock' attach-session -r -t 'pi cond run'",
    );
  });

  it("exposes active worker viewing as a registered tool", async () => {
    const worker = await createWorkerForRepo(repoDir, "tool-worker");
    const task = createTaskForRepo(repoDir, { title: "Tool task", prompt: "Watch me" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    startTaskRunForRepo(repoDir, { taskId: task.taskId, runtimeMode: "tmux" });

    const tool = collectTools().find((entry) => entry.name === "conductor_view_active_workers");
    const result = (await tool?.execute?.("tool-call-1", { taskId: task.taskId }, undefined, undefined, {
      cwd: repoDir,
    })) as { content: Array<{ text: string }>; details: { entries: unknown[] } };

    expect(result.content[0]?.text).toContain("active supervised conductor workers: 1");
    expect(result.content[0]?.text).toContain("tool-worker");
    expect(result.details.entries).toHaveLength(1);
  });

  it("returns an empty active-viewer response for headless or terminal runs", async () => {
    const worker = await createWorkerForRepo(repoDir, "headless-worker");
    const task = createTaskForRepo(repoDir, { title: "Headless task", prompt: "Run" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    startTaskRunForRepo(repoDir, { taskId: task.taskId, runtimeMode: "headless" });

    const summary = summarizeActiveWorkerViewersForRepo(repoDir);

    expect(summary.entries).toEqual([]);
    expect(formatActiveWorkerViewerSummary(summary)).toBe(
      "no active supervised conductor workers matched the requested scope",
    );
  });
});
