import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
import { deriveProjectKey } from "../extensions/project-key.js";
import { createRunRuntimeMetadata } from "../extensions/runtime-metadata.js";
import { completeTaskRun, getRunFile, writeRun } from "../extensions/storage.js";

type RegisteredTool = {
  name: string;
  parameters?: unknown;
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
    expect(summary.entries[0]?.nextToolCalls).toEqual([
      { name: "conductor_view_active_workers", params: { runId: started.run.runId }, purpose: "refresh" },
      {
        name: "conductor_resource_timeline",
        params: { runId: started.run.runId, includeArtifacts: true },
        purpose: "timeline",
      },
      {
        name: "conductor_cancel_task_run",
        params: { runId: started.run.runId, reason: "<reason>" },
        purpose: "cancel",
      },
    ]);

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
                  socketPath: "/tmp/with space/it's/tmux.sock",
                  sessionName: "pi cond run 'quoted'",
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
      "tmux -S '/tmp/with space/it'\"'\"'s/tmux.sock' attach-session -r -t 'pi cond run '\"'\"'quoted'\"'\"''",
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
    const schema = JSON.stringify(tool?.parameters);
    expect(schema).toContain("taskId");
    expect(schema).toContain("workerId");
    expect(schema).toContain("runId");
  });

  it("filters active supervised workers by task, worker, and run", async () => {
    const firstWorker = await createWorkerForRepo(repoDir, "first-worker");
    const secondWorker = await createWorkerForRepo(repoDir, "second-worker");
    const firstTask = createTaskForRepo(repoDir, { title: "First task", prompt: "Run" });
    const secondTask = createTaskForRepo(repoDir, { title: "Second task", prompt: "Run" });
    assignTaskForRepo(repoDir, firstTask.taskId, firstWorker.workerId);
    assignTaskForRepo(repoDir, secondTask.taskId, secondWorker.workerId);
    const firstRun = startTaskRunForRepo(repoDir, { taskId: firstTask.taskId, runtimeMode: "tmux" });
    const secondRun = startTaskRunForRepo(repoDir, { taskId: secondTask.taskId, runtimeMode: "iterm-tmux" });

    expect(summarizeActiveWorkerViewersForRepo(repoDir).entries).toHaveLength(2);
    expect(summarizeActiveWorkerViewersForRepo(repoDir, { taskId: firstTask.taskId }).entries).toMatchObject([
      { taskId: firstTask.taskId, runId: firstRun.run.runId },
    ]);
    expect(summarizeActiveWorkerViewersForRepo(repoDir, { workerId: secondWorker.workerId }).entries).toMatchObject([
      { workerId: secondWorker.workerId, runId: secondRun.run.runId },
    ]);
    expect(summarizeActiveWorkerViewersForRepo(repoDir, { runId: secondRun.run.runId }).entries).toMatchObject([
      { taskId: secondTask.taskId, runId: secondRun.run.runId },
    ]);
    expect(
      summarizeActiveWorkerViewersForRepo(repoDir, { taskId: firstTask.taskId, workerId: secondWorker.workerId })
        .entries,
    ).toEqual([]);
  });

  it("renders next-action tool calls in model-visible text", async () => {
    const worker = await createWorkerForRepo(repoDir, "next-action-worker");
    const task = createTaskForRepo(repoDir, { title: "Next action task", prompt: "Watch me" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, runtimeMode: "tmux" });

    const tool = collectTools().find((entry) => entry.name === "conductor_next_actions");
    const result = (await tool?.execute?.(
      "tool-call-1",
      { includeLowPriority: true, reconcile: false },
      undefined,
      undefined,
      { cwd: repoDir },
    )) as { content: Array<{ text: string }> };

    expect(result.content[0]?.text).toContain("conductor_view_active_workers");
    expect(result.content[0]?.text).toContain(started.run.runId);
  });

  it("returns an empty active-viewer response without creating conductor state", () => {
    const runFile = getRunFile(deriveProjectKey(resolve(repoDir)));

    const summary = summarizeActiveWorkerViewersForRepo(repoDir);

    expect(summary.entries).toEqual([]);
    expect(existsSync(runFile)).toBe(false);
  });

  it("returns an empty active-viewer response for headless or terminal supervised runs", async () => {
    const headlessWorker = await createWorkerForRepo(repoDir, "headless-worker");
    const headlessTask = createTaskForRepo(repoDir, { title: "Headless task", prompt: "Run" });
    assignTaskForRepo(repoDir, headlessTask.taskId, headlessWorker.workerId);
    startTaskRunForRepo(repoDir, { taskId: headlessTask.taskId, runtimeMode: "headless" });
    const tmuxWorker = await createWorkerForRepo(repoDir, "terminal-worker");
    const tmuxTask = createTaskForRepo(repoDir, { title: "Terminal task", prompt: "Run" });
    assignTaskForRepo(repoDir, tmuxTask.taskId, tmuxWorker.workerId);
    const terminalRun = startTaskRunForRepo(repoDir, { taskId: tmuxTask.taskId, runtimeMode: "tmux" });
    writeRun(
      completeTaskRun(getOrCreateRunForRepo(repoDir), {
        runId: terminalRun.run.runId,
        status: "succeeded",
        completionSummary: "done",
      }),
    );

    const summary = summarizeActiveWorkerViewersForRepo(repoDir);

    expect(summary.entries).toEqual([]);
    expect(formatActiveWorkerViewerSummary(summary)).toBe(
      "no active supervised conductor workers matched the requested scope",
    );
  });

  it("omits active-looking supervised runs with terminal runtime status", async () => {
    const worker = await createWorkerForRepo(repoDir, "stale-worker");
    const task = createTaskForRepo(repoDir, { title: "Stale task", prompt: "Run" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, runtimeMode: "tmux" });
    const run = getOrCreateRunForRepo(repoDir);
    writeRun({
      ...run,
      runs: run.runs.map((entry) =>
        entry.runId === started.run.runId
          ? { ...entry, runtime: { ...entry.runtime, status: "exited_error" as const } }
          : entry,
      ),
    });

    expect(summarizeActiveWorkerViewersForRepo(repoDir).entries).toEqual([]);
  });
});
