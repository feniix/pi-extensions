import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assignTaskForRepo,
  buildTaskBriefForRepo,
  createObjectiveForRepo,
  createTaskForRepo,
  createWorkerForRepo,
  getOrCreateRunForRepo,
  startTaskRunForRepo,
} from "../extensions/conductor.js";
import { createRunRuntimeMetadata } from "../extensions/runtime-metadata.js";
import { completeTaskRun, writeRun } from "../extensions/storage.js";

describe("conductor task brief", () => {
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

  it("builds a model-ready task brief with objective and worker context", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const objective = createObjectiveForRepo(repoDir, { title: "Autonomous MVP", prompt: "Ship autonomy" });
    const task = createTaskForRepo(repoDir, {
      title: "Build task brief",
      prompt: "Create LLM task context",
      objectiveId: objective.objectiveId,
    });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId });

    const brief = buildTaskBriefForRepo(repoDir, { taskId: task.taskId });

    expect(brief.markdown).toContain("# Conductor Task Brief");
    expect(brief.task.taskId).toBe(task.taskId);
    expect(brief.objective?.objectiveId).toBe(objective.objectiveId);
    expect(brief.worker?.workerId).toBe(worker.workerId);
    expect(brief.markdown).toContain(`- ${started.run.runId} status=running`);
    expect(brief.markdown).toContain("runtimeMode=headless runtimeStatus=running");
    expect(brief.suggestedNextTool).toBeNull();
  });

  it("includes completed run completion summaries in task briefs", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Completed summary", prompt: "Summarize completion" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId });
    writeRun(
      completeTaskRun(getOrCreateRunForRepo(repoDir), {
        runId: started.run.runId,
        status: "succeeded",
        completionSummary: "Implemented the feature and verified it with targeted tests.",
      }),
    );

    const brief = buildTaskBriefForRepo(repoDir, { taskId: task.taskId });

    expect(brief.markdown).toContain("## Terminal Summary");
    expect(brief.markdown).toContain(`Run: ${started.run.runId} status=succeeded`);
    expect(brief.markdown).toContain(
      "Completion summary: Implemented the feature and verified it with targeted tests.",
    );
    expect(brief.terminalRun?.runId).toBe(started.run.runId);
  });

  it("includes failed run error messages in task briefs", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Failed summary", prompt: "Summarize failure" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId });
    writeRun(
      completeTaskRun(getOrCreateRunForRepo(repoDir), {
        runId: started.run.runId,
        status: "failed",
        completionSummary: "Could not finish because validation failed.",
        errorMessage: "Typecheck failed in storage.ts",
      }),
    );

    const brief = buildTaskBriefForRepo(repoDir, { taskId: task.taskId });

    expect(brief.markdown).toContain("## Terminal Summary");
    expect(brief.markdown).toContain(`Run: ${started.run.runId} status=failed`);
    expect(brief.markdown).toContain("Error: Typecheck failed in storage.ts");
    expect(brief.markdown).toContain("Completion summary: Could not finish because validation failed.");
  });

  it("formats multiline terminal summaries as indented markdown blocks", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Multiline summary", prompt: "Summarize multiline output" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId });
    writeRun(
      completeTaskRun(getOrCreateRunForRepo(repoDir), {
        runId: started.run.runId,
        status: "succeeded",
        completionSummary: "Line one\n## injected heading\n- injected list",
      }),
    );

    const brief = buildTaskBriefForRepo(repoDir, { taskId: task.taskId });

    expect(brief.markdown).toContain("Completion summary:\n    Line one\n    ## injected heading\n    - injected list");
    expect(brief.markdown).not.toContain("\n## injected heading\n");
  });

  it("normalizes carriage-return terminal summaries before markdown formatting", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "CR summary", prompt: "Summarize CR output" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId });
    writeRun(
      completeTaskRun(getOrCreateRunForRepo(repoDir), {
        runId: started.run.runId,
        status: "succeeded",
        completionSummary: "ok\r## injected heading",
      }),
    );

    const brief = buildTaskBriefForRepo(repoDir, { taskId: task.taskId });

    expect(brief.markdown).toContain("Completion summary:\n    ok\n    ## injected heading");
    expect(brief.markdown).not.toContain("\r## injected heading");
  });

  it("truncates long terminal summaries in task briefs", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Long summary", prompt: "Summarize long output" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId });
    writeRun(
      completeTaskRun(getOrCreateRunForRepo(repoDir), {
        runId: started.run.runId,
        status: "succeeded",
        completionSummary: "x".repeat(1300),
      }),
    );

    const brief = buildTaskBriefForRepo(repoDir, { taskId: task.taskId });

    expect(brief.markdown).toContain("Completion summary: ");
    expect(brief.markdown).toContain("(truncated; inspect run details or artifacts for full output)");
    expect(brief.markdown).not.toContain("x".repeat(1300));
  });

  it("surfaces visible runtime supervision details in task briefs", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Visible task brief", prompt: "Create visible context" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, runtimeMode: "iterm-tmux" });
    const run = getOrCreateRunForRepo(repoDir);
    writeRun({
      ...run,
      tasks: run.tasks.map((entry) =>
        entry.taskId === task.taskId ? { ...entry, latestProgress: "opening viewer" } : entry,
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

    const brief = buildTaskBriefForRepo(repoDir, { taskId: task.taskId });

    expect(brief.markdown).toContain("Latest progress: opening viewer");
    expect(brief.markdown).toContain(`- ${started.run.runId} status=running`);
    expect(brief.markdown).toContain("runtimeMode=iterm-tmux runtimeStatus=running viewer=opened");
    expect(brief.markdown).toContain("viewerCommand=\"tmux -S '/tmp/tmux.sock' attach-session -r -t 'pi-cond-run'\"");
    expect(brief.markdown).toContain("log=/tmp/pi-conductor/runtime/run-1/runner.log");
    expect(brief.markdown).toContain(
      `cancel=conductor_cancel_task_run({"runId":"${started.run.runId}","reason":"<reason>"})`,
    );
  });
});
