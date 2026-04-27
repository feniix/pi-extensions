import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assignTaskForRepo,
  cancelTaskRunForRepo,
  createTaskForRepo,
  createWorkerForRepo,
  getOrCreateRunForRepo,
  startTaskRunForRepo,
} from "../extensions/conductor.js";
import conductorExtension from "../extensions/index.js";

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
  const fakePi = {
    registerCommand: () => undefined,
    registerTool: (tool: RegisteredTool) => tools.push(tool),
  };
  conductorExtension(fakePi as never);
  return tools;
}

function getTool(tools: RegisteredTool[], name: string): RegisteredTool {
  const tool = tools.find((entry) => entry.name === name);
  if (!tool?.execute) {
    throw new Error(`Tool ${name} not registered with an execute handler`);
  }
  return tool;
}

describe("conductor runtime-mode tool contracts", () => {
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

  it("forwards runtimeMode through registered start, run, retry, and delegate tools", async () => {
    const tools = collectTools();
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Visible tool task", prompt: "Run visibly" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);

    await expect(
      getTool(tools, "conductor_start_task_run").execute?.(
        "tool-call-1",
        { taskId: task.taskId, runtimeMode: "iterm-tmux" },
        undefined,
        undefined,
        { cwd: repoDir },
      ),
    ).rejects.toThrow(/Runtime mode iterm-tmux unavailable/i);
    expect(getOrCreateRunForRepo(repoDir).runs).toHaveLength(0);

    await expect(
      getTool(tools, "conductor_run_task").execute?.(
        "tool-call-2",
        { taskId: task.taskId, runtimeMode: "iterm-tmux" },
        undefined,
        undefined,
        { cwd: repoDir },
      ),
    ).rejects.toThrow(/Runtime mode iterm-tmux unavailable/i);
    expect(getOrCreateRunForRepo(repoDir).runs).toHaveLength(0);

    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId });
    cancelTaskRunForRepo(repoDir, { runId: started.run.runId, reason: "prepare retry" });
    await expect(
      getTool(tools, "conductor_retry_task").execute?.(
        "tool-call-3",
        { taskId: task.taskId, runtimeMode: "iterm-tmux" },
        undefined,
        undefined,
        { cwd: repoDir },
      ),
    ).rejects.toThrow(/Runtime mode iterm-tmux unavailable/i);
    expect(getOrCreateRunForRepo(repoDir).runs).toHaveLength(1);

    await expect(
      getTool(tools, "conductor_delegate_task").execute?.(
        "tool-call-4",
        {
          title: "Visible delegate",
          prompt: "Run visibly",
          workerName: "delegate-visible",
          startRun: true,
          runtimeMode: "iterm-tmux",
        },
        undefined,
        undefined,
        { cwd: repoDir },
      ),
    ).rejects.toThrow(/Runtime mode iterm-tmux unavailable/i);
    const run = getOrCreateRunForRepo(repoDir);
    expect(run.tasks.at(-1)).toMatchObject({ title: "Visible delegate", state: "assigned", activeRunId: null });
  });

  it("surfaces runtime status through registered list-runs and backend-status tools", async () => {
    const tools = collectTools();
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Visible status", prompt: "Report status" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId });

    const listRuns = (await getTool(tools, "conductor_list_runs").execute?.("tool-call-5", {}, undefined, undefined, {
      cwd: repoDir,
    })) as { content: Array<{ text: string }>; details: { runs: Array<{ runtime?: unknown }> } };
    expect(listRuns.content[0]?.text).toContain(`${started.run.runId} task=${task.taskId}`);
    expect(listRuns.content[0]?.text).toContain("runtimeMode=headless runtimeStatus=running");
    expect(listRuns.details.runs[0]?.runtime).toMatchObject({ mode: "headless", status: "running" });

    const backendStatus = (await getTool(tools, "conductor_backend_status").execute?.(
      "tool-call-6",
      {},
      undefined,
      undefined,
      { cwd: repoDir },
    )) as { content: Array<{ text: string }>; details: { runtimes: Record<string, { available: boolean }> } };
    expect(backendStatus.content[0]?.text).toContain("runtime headless: available=true");
    expect(backendStatus.content[0]?.text).toContain("runtime tmux: available=");
    expect(backendStatus.details.runtimes.headless).toMatchObject({ available: true });
    expect(backendStatus.details.runtimes.tmux).toMatchObject({ mode: "tmux" });
  });
});
