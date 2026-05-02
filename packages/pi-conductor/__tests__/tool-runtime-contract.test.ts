import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  description?: string;
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

describe("conductor tool contracts", () => {
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

  it("documents parallel pre-run startup cancellation and cleanup guidance semantics", () => {
    const tool = collectTools().find((entry) => entry.name === "conductor_run_parallel_work");

    expect(tool?.description).toContain("fails before active run creation");
    expect(tool?.description).toContain("cleanupRecommendations");
    expect(tool?.description).toContain("conductor_cleanup_worker");
  });

  it("documents gate-protected cleanup worker flow", () => {
    const tool = collectTools().find((entry) => entry.name === "conductor_cleanup_worker");

    expect(tool?.description).toContain("destructive_cleanup gate");
    expect(tool?.description).toContain("/conductor human dashboard");
    expect(tool?.description).toContain("rerun conductor_cleanup_worker");
  });

  it("documents high-level parallel runtime defaults and blocking override", () => {
    const tool = collectTools().find((entry) => entry.name === "conductor_run_work");
    const schema = JSON.stringify(tool?.parameters);

    expect(tool?.description).toContain("parallel work prefers supervised tmux");
    expect(tool?.description).toContain("falls back to headless");
    expect(tool?.description).toContain("conductor_view_active_workers");
    expect(tool?.description).toContain("details.parallel.results[].executionState");
    expect(tool?.description).toContain("must not treat tool success as semantic completion");
    expect(tool?.description).toContain("cleanupRecommendations");
    expect(schema).toContain("Pass headless for blocking execution");
    expect(schema).toContain("parallel work prefer tmux");
  });

  it("documents evidence bundle purpose values and invalid-purpose diagnostics", async () => {
    const tools = collectTools();
    const evidenceTool = getTool(tools, "conductor_build_evidence_bundle");
    const readinessTool = getTool(tools, "conductor_check_readiness");
    const evidenceSchema = JSON.stringify(evidenceTool.parameters);
    const readinessSchema = JSON.stringify(readinessTool.parameters);

    expect(evidenceTool.description).toContain("task_review, pr_readiness, handoff");
    expect(evidenceTool.description).toContain("Default: task_review");
    expect(evidenceSchema).toContain("Valid values: task_review");
    expect(evidenceSchema).toContain("pr_readiness");
    expect(evidenceSchema).toContain("handoff");
    expect(readinessTool.description).toContain("task_review, pr_readiness");
    expect(readinessTool.description).toContain("If invalid, retry");
    expect(readinessSchema).toContain("Valid values: task_review");
    expect(readinessSchema).toContain("pr_readiness");
    await expect(
      evidenceTool.execute?.("tool-call-purpose", { taskId: "task-1", purpose: "review" }, undefined, undefined, {
        cwd: repoDir,
      }),
    ).rejects.toThrow(/Accepted values: task_review, pr_readiness, handoff/);
    await expect(
      evidenceTool.execute?.("tool-call-purpose", { taskId: "task-1", purpose: "" }, undefined, undefined, {
        cwd: repoDir,
      }),
    ).rejects.toThrow(/Accepted values: task_review, pr_readiness, handoff/);
    await expect(
      readinessTool.execute?.("tool-call-readiness", { taskId: "task-1", purpose: "review" }, undefined, undefined, {
        cwd: repoDir,
      }),
    ).rejects.toThrow(/Accepted values: task_review, pr_readiness/);
  });

  it("forwards runtimeMode through registered start, run, retry, and delegate tools", async () => {
    const originalPath = process.env.PATH;
    const tools = collectTools();
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Visible tool task", prompt: "Run visibly" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);

    const fakeBin = mkdtempSync(join(tmpdir(), "pi-conductor-fake-bin-"));
    const fakeTmux = join(fakeBin, "tmux");
    writeFileSync(fakeTmux, "#!/bin/sh\nexit 127\n", "utf-8");
    chmodSync(fakeTmux, 0o755);
    process.env.PATH = `${fakeBin}:${originalPath ?? ""}`;
    try {
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
      await cancelTaskRunForRepo(repoDir, { runId: started.run.runId, reason: "prepare retry" });
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
    } finally {
      process.env.PATH = originalPath;
      rmSync(fakeBin, { recursive: true, force: true });
    }
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
