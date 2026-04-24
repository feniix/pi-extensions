import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assessTaskForRepo,
  buildBlockingDiagnosisForRepo,
  buildObjectiveDagForRepo,
  createGateForRepo,
  createObjectiveForRepo,
  createTaskForRepo,
  getOrCreateRunForRepo,
  prepareHumanReviewForRepo,
  recordTaskCompletionForRepo,
  runNextActionForRepo,
  startTaskRunForRepo,
} from "../extensions/conductor.js";
import { addConductorArtifact, readArtifactContentForRepo, writeRun } from "../extensions/storage.js";

describe("LLM autonomous control helpers", () => {
  let conductorHome: string;
  let repoRoot: string;

  beforeEach(() => {
    conductorHome = mkdtempSync(join(tmpdir(), "pi-conductor-home-"));
    repoRoot = mkdtempSync(join(tmpdir(), "pi-conductor-repo-"));
    process.env.PI_CONDUCTOR_HOME = conductorHome;
  });

  afterEach(() => {
    delete process.env.PI_CONDUCTOR_HOME;
    if (existsSync(conductorHome)) rmSync(conductorHome, { recursive: true, force: true });
    if (existsSync(repoRoot)) rmSync(repoRoot, { recursive: true, force: true });
  });

  it("executes the safest non-human next action", async () => {
    const objective = createObjectiveForRepo(repoRoot, { title: "Ship", prompt: "Plan tasks" });

    const result = await runNextActionForRepo(repoRoot, { objectiveId: objective.objectiveId });

    expect(result.executed).toBe(true);
    expect(result.action?.kind).toBe("plan_objective");
    expect(getOrCreateRunForRepo(repoRoot).tasks).toHaveLength(1);
  });

  it("assesses task readiness and evidence", () => {
    const task = createTaskForRepo(repoRoot, { title: "Assess", prompt: "Do it" });

    const assessment = assessTaskForRepo(repoRoot, { taskId: task.taskId });

    expect(assessment.verdict).toBe("not_ready");
    expect(assessment.findings.map((finding) => finding.code)).toContain("missing_completion_report");
  });

  it("reads safe local artifact content with bounded output", () => {
    writeFileSync(join(repoRoot, "evidence.txt"), "proof", "utf-8");
    const run = addConductorArtifact(getOrCreateRunForRepo(repoRoot), {
      artifactId: "artifact-1",
      type: "note",
      ref: "evidence.txt",
      resourceRefs: {},
      producer: { type: "test", id: "test" },
    });
    writeRun(run);

    expect(readArtifactContentForRepo(repoRoot, "artifact-1", { maxBytes: 3 })).toMatchObject({
      artifactId: "artifact-1",
      content: "pro",
      truncated: true,
    });
  });

  it("builds objective DAG batches", () => {
    const objective = createObjectiveForRepo(repoRoot, { title: "DAG", prompt: "Sequence work" });
    const first = createTaskForRepo(repoRoot, {
      title: "First",
      prompt: "Do first",
      objectiveId: objective.objectiveId,
    });
    const second = createTaskForRepo(repoRoot, {
      title: "Second",
      prompt: "Do second",
      objectiveId: objective.objectiveId,
      dependsOnTaskIds: [first.taskId],
    });

    const dag = buildObjectiveDagForRepo(repoRoot, objective.objectiveId);

    expect(dag.batches).toEqual([[first.taskId], [second.taskId]]);
    expect(dag.parallelizableBatches).toHaveLength(2);
  });

  it("prepares human review packets and blocker diagnoses", () => {
    const objective = createObjectiveForRepo(repoRoot, { title: "Review", prompt: "Need input" });
    const task = createTaskForRepo(repoRoot, { title: "Task", prompt: "Do it", objectiveId: objective.objectiveId });
    const gate = createGateForRepo(repoRoot, {
      type: "needs_input",
      resourceRefs: { objectiveId: objective.objectiveId, taskId: task.taskId },
      requestedDecision: "Choose API",
    });

    const packet = prepareHumanReviewForRepo(repoRoot, { objectiveId: objective.objectiveId });
    const diagnosis = buildBlockingDiagnosisForRepo(repoRoot, { objectiveId: objective.objectiveId });

    expect(packet.markdown).toContain("# Conductor Human Review Packet");
    expect(diagnosis.blockers[0]).toMatchObject({
      kind: "gate",
      gateId: gate.gateId,
      nextToolCall: { name: "conductor_resolve_gate" },
    });
  });

  it("auto-refreshes objective status when task completion is recorded", () => {
    const objective = createObjectiveForRepo(repoRoot, { title: "Auto", prompt: "Refresh me" });
    const task = createTaskForRepo(repoRoot, { title: "Done", prompt: "Complete", objectiveId: objective.objectiveId });
    const run = getOrCreateRunForRepo(repoRoot);
    const worker = {
      workerId: "worker-1",
      name: "worker",
      branch: null,
      worktreePath: "/tmp/worktree",
      sessionFile: "/tmp/session",
      runtime: { backend: "session_manager" as const, sessionId: null, lastResumedAt: null },
      currentTask: null,
      lifecycle: "idle" as const,
      recoverable: false,
      lastRun: null,
      summary: { text: null, updatedAt: null, stale: false },
      pr: { url: null, number: null, commitSucceeded: false, pushSucceeded: false, prCreationAttempted: false },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeRun({
      ...run,
      workers: [worker],
      tasks: run.tasks.map((entry) =>
        entry.taskId === task.taskId ? { ...entry, assignedWorkerId: worker.workerId, state: "assigned" } : entry,
      ),
    });
    const started = startTaskRunForRepo(repoRoot, { taskId: task.taskId, workerId: worker.workerId });

    recordTaskCompletionForRepo(repoRoot, {
      taskId: task.taskId,
      runId: started.run.runId,
      status: "succeeded",
      completionSummary: "done",
      artifact: { type: "completion_report", ref: "completion://done" },
    });

    expect(getOrCreateRunForRepo(repoRoot).objectives[0]?.status).toBe("completed");
  });
});
