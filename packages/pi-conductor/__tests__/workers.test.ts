import { describe, expect, it } from "vitest";
import { createEmptyRun, createWorkerRecord, setWorkerTask } from "../extensions/storage.js";
import { buildBranchName, createWorkerId, normalizeWorkerSlug } from "../extensions/workers.js";

describe("worker helpers", () => {
  it("normalizes worker names into branch-safe slugs", () => {
    expect(normalizeWorkerSlug("Fix Auth")).toBe("fix-auth");
    expect(normalizeWorkerSlug("frontend/api")).toBe("frontend-api");
    expect(normalizeWorkerSlug("***")).toBeNull();
  });

  it("builds a branch name from a normalized worker slug", () => {
    expect(buildBranchName("worker-1", "Fix Auth")).toBe("conductor/fix-auth");
    expect(buildBranchName("worker-1", "***")).toBe("conductor/worker-1");
  });

  it("creates stable-enough worker ids with conductor prefix", () => {
    const id = createWorkerId();
    expect(id.startsWith("worker-")).toBe(true);
    expect(id.length).toBeGreaterThan(10);
  });

  it("updating a task marks an existing summary as stale", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: "/tmp/session.jsonl",
    });
    worker.summary.text = "Current progress";
    worker.summary.updatedAt = new Date().toISOString();

    const updated = setWorkerTask({ ...run, workers: [worker] }, "worker-1", "implement status command");
    expect(updated.workers[0]?.currentTask).toBe("implement status command");
    expect(updated.workers[0]?.summary.stale).toBe(true);
  });
});
