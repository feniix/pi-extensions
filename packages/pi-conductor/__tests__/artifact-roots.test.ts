import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTaskForRepo, getOrCreateRunForRepo } from "../extensions/conductor.js";
import { addConductorArtifact, readArtifactContentForRepo, writeRun } from "../extensions/storage.js";

describe("conductor artifact root classification", () => {
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

  it("reads storage-root artifacts relative to conductor storage", () => {
    const run = getOrCreateRunForRepo(repoRoot);
    writeFileSync(join(run.storageDir, "stored.txt"), "from storage", "utf-8");
    const updated = addConductorArtifact(run, {
      artifactId: "artifact-storage-root",
      type: "log",
      ref: "stored.txt",
      resourceRefs: {},
      producer: { type: "test", id: "test" },
      metadata: { root: "storage" },
    });
    writeRun(updated);

    expect(readArtifactContentForRepo(repoRoot, "artifact-storage-root")).toMatchObject({
      content: "from storage",
      diagnostic: null,
    });
  });

  it("reads local artifacts relative to a trusted worker worktree root", () => {
    const task = createTaskForRepo(repoRoot, { title: "Artifact root", prompt: "Read from worker root" });
    const workerRoot = join(repoRoot, "worker-root");
    mkdirSync(workerRoot, { recursive: true });
    writeFileSync(join(workerRoot, "worker.log"), "from worker root", "utf-8");
    const run = getOrCreateRunForRepo(repoRoot);
    let updated: typeof run = {
      ...run,
      workers: [
        {
          workerId: "worker-1",
          name: "worker",
          branch: null,
          worktreePath: workerRoot,
          sessionFile: null,
          runtime: { backend: "session_manager" as const, sessionId: null, lastResumedAt: null },
          currentTask: null,
          lifecycle: "idle" as const,
          recoverable: false,
          lastRun: null,
          summary: { text: null, updatedAt: null, stale: false },
          pr: { url: null, number: null, commitSucceeded: false, pushSucceeded: false, prCreationAttempted: false },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      tasks: run.tasks.map((entry) =>
        entry.taskId === task.taskId ? { ...entry, assignedWorkerId: "worker-1", state: "assigned" as const } : entry,
      ),
    };
    updated = addConductorArtifact(updated, {
      artifactId: "artifact-worker-root",
      type: "log",
      ref: "worker.log",
      resourceRefs: { workerId: "worker-1" },
      producer: { type: "test", id: "test" },
      metadata: { worktreeRoot: workerRoot },
    });
    writeRun(updated);

    expect(readArtifactContentForRepo(repoRoot, "artifact-worker-root")).toMatchObject({
      content: "from worker root",
      diagnostic: null,
    });
  });
});
