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
import { writeRun } from "../extensions/storage.js";

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
