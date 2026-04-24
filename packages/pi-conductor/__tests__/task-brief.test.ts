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
} from "../extensions/conductor.js";

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

    const brief = buildTaskBriefForRepo(repoDir, { taskId: task.taskId });

    expect(brief.markdown).toContain("# Conductor Task Brief");
    expect(brief.task.taskId).toBe(task.taskId);
    expect(brief.objective?.objectiveId).toBe(objective.objectiveId);
    expect(brief.worker?.workerId).toBe(worker.workerId);
    expect(brief.suggestedNextTool).toMatchObject({ name: "conductor_run_task", params: { taskId: task.taskId } });
  });
});
