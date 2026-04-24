import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildProjectBriefForRepo,
  createGateForRepo,
  createObjectiveForRepo,
  createTaskForRepo,
  createWorkerForRepo,
} from "../extensions/conductor.js";

describe("conductor project brief", () => {
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

  it("builds an LLM-oriented project brief with counts, blockers, and next actions", async () => {
    await createWorkerForRepo(repoDir, "backend");
    const objective = createObjectiveForRepo(repoDir, { title: "Autonomous MVP", prompt: "Ship conductor autonomy" });
    const task = createTaskForRepo(repoDir, {
      title: "Build brief",
      prompt: "Summarize state",
      objectiveId: objective.objectiveId,
    });
    createGateForRepo(repoDir, {
      type: "needs_input",
      resourceRefs: { objectiveId: objective.objectiveId, taskId: task.taskId },
      requestedDecision: "Which next action should run?",
    });

    const brief = buildProjectBriefForRepo(repoDir, { maxActions: 3, recentEventLimit: 5 });

    expect(brief.markdown).toContain("# Conductor Project Brief");
    expect(brief.project.counts).toMatchObject({ workers: 1, objectives: 1, tasks: 1, gates: 1 });
    expect(brief.objectives[0]).toMatchObject({ objectiveId: objective.objectiveId, title: "Autonomous MVP" });
    expect(brief.blockers[0]).toMatchObject({
      type: "needs_input",
      requestedDecision: "Which next action should run?",
    });
    expect(brief.nextActions.length).toBeGreaterThan(0);
    expect(brief.recentEvents.length).toBeLessThanOrEqual(5);
  });
});
