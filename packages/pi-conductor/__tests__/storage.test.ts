import { describe, expect, it } from "vitest";
import { addWorker, createEmptyRun, createWorkerRecord, getConductorProjectDir } from "../extensions/storage.js";

describe("storage helpers", () => {
  it("creates an empty run", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    expect(run.projectKey).toBe("abc");
    expect(run.repoRoot).toBe("/tmp/repo");
    expect(run.workers).toEqual([]);
  });

  it("builds a conductor project dir", () => {
    const dir = getConductorProjectDir("abc");
    expect(dir).toContain(".pi/agent/conductor/projects/abc");
  });

  it("creates a worker record with default lifecycle metadata", () => {
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: null,
    });

    expect(worker.workerId).toBe("worker-1");
    expect(worker.name).toBe("backend");
    expect(worker.lifecycle).toBe("idle");
    expect(worker.currentTask).toBeNull();
    expect(worker.recoverable).toBe(false);
    expect(worker.summary.stale).toBe(false);
    expect(worker.pr.prCreationAttempted).toBe(false);
  });

  it("adds a worker and updates the run timestamp", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: null,
    });

    const updated = addWorker(run, worker);
    expect(updated.workers).toHaveLength(1);
    expect(updated.workers[0]?.name).toBe("backend");
    expect(updated.updatedAt >= run.updatedAt).toBe(true);
  });

  it("rejects duplicate worker names within a project", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: null,
    });

    const updated = addWorker(run, worker);
    expect(() =>
      addWorker(
        updated,
        createWorkerRecord({
          workerId: "worker-2",
          name: "backend",
          branch: "conductor/backend-2",
          worktreePath: "/tmp/repo/.worktrees/backend-2",
          sessionFile: null,
        }),
      ),
    ).toThrow(/already exists/i);
  });
});
