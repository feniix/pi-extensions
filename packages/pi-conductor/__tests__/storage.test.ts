import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addWorker,
  createEmptyRun,
  createWorkerRecord,
  finishWorkerRun,
  getConductorProjectDir,
  readRun,
  setWorkerLifecycle,
  setWorkerRunSessionId,
  setWorkerRuntimeState,
  startWorkerRun,
} from "../extensions/storage.js";

describe("storage helpers", () => {
  let conductorHome: string;

  beforeEach(() => {
    conductorHome = mkdtempSync(join(tmpdir(), "pi-conductor-home-"));
    process.env.PI_CONDUCTOR_HOME = conductorHome;
  });

  afterEach(() => {
    delete process.env.PI_CONDUCTOR_HOME;
    if (conductorHome && existsSync(conductorHome)) {
      rmSync(conductorHome, { recursive: true, force: true });
    }
  });
  it("creates an empty run", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    expect(run.projectKey).toBe("abc");
    expect(run.repoRoot).toBe("/tmp/repo");
    expect(run.workers).toEqual([]);
  });

  it("builds a conductor project dir", () => {
    const dir = getConductorProjectDir("abc");
    expect(dir).toBe(join(conductorHome, "projects", "abc"));
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
    expect(worker.runtime.backend).toBe("session_manager");
    expect(worker.runtime.sessionId).toBeNull();
    expect(worker.runtime.lastResumedAt).toBeNull();
    expect(worker.lastRun).toBeNull();
  });

  it("normalizes missing lastRun when reading older persisted workers", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: null,
    });

    mkdirSync(run.storageDir, { recursive: true });
    const path = join(run.storageDir, "run.json");
    const legacyWorker = JSON.parse(JSON.stringify(worker)) as Record<string, unknown>;
    delete legacyWorker.lastRun;
    writeFileSync(
      path,
      `${JSON.stringify(
        {
          ...run,
          workers: [legacyWorker],
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    const persisted = readRun("abc");
    expect(persisted?.workers[0]?.lastRun).toBeNull();
  });

  it("marks an existing summary stale when the worker lifecycle changes", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: null,
    });
    worker.summary.text = "Half done";
    worker.summary.updatedAt = new Date().toISOString();

    const updated = setWorkerLifecycle({ ...run, workers: [worker] }, worker.workerId, "running");
    expect(updated.workers[0]?.summary.stale).toBe(true);
  });

  it("marks a worker as running and persists lastRun metadata when a run starts", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: "/tmp/session.jsonl",
    });
    worker.summary.text = "Half done";
    worker.summary.updatedAt = new Date().toISOString();

    const updated = startWorkerRun({ ...run, workers: [worker] }, worker.workerId, {
      task: "implement status output",
      sessionId: "run-session-1",
    });

    expect(updated.workers[0]?.lifecycle).toBe("running");
    expect(updated.workers[0]?.currentTask).toBe("implement status output");
    expect(updated.workers[0]?.summary.stale).toBe(true);
    expect(updated.workers[0]?.lastRun).toMatchObject({
      task: "implement status output",
      status: null,
      finishedAt: null,
      errorMessage: null,
      sessionId: "run-session-1",
    });
    expect(updated.workers[0]?.lastRun?.startedAt).toBeTruthy();
  });

  it("requires an active run before attaching a run session id", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: "/tmp/session.jsonl",
    });

    expect(() => setWorkerRunSessionId({ ...run, workers: [worker] }, worker.workerId, "run-session-1")).toThrow(
      /does not have an active lastRun/i,
    );
  });

  it("completes a run with success, aborted, and error lifecycle semantics", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: "/tmp/session.jsonl",
    });
    const started = startWorkerRun({ ...run, workers: [worker] }, worker.workerId, {
      task: "implement status output",
      sessionId: "run-session-1",
    });

    const succeeded = finishWorkerRun(started, worker.workerId, { status: "success" });
    expect(succeeded.workers[0]?.lifecycle).toBe("idle");
    expect(succeeded.workers[0]?.lastRun?.status).toBe("success");
    expect(succeeded.workers[0]?.lastRun?.finishedAt).toBeTruthy();

    const aborted = finishWorkerRun(started, worker.workerId, { status: "aborted" });
    expect(aborted.workers[0]?.lifecycle).toBe("idle");
    expect(aborted.workers[0]?.lastRun?.status).toBe("aborted");

    const errored = finishWorkerRun(started, worker.workerId, {
      status: "error",
      errorMessage: "model unavailable",
    });
    expect(errored.workers[0]?.lifecycle).toBe("blocked");
    expect(errored.workers[0]?.lastRun?.status).toBe("error");
    expect(errored.workers[0]?.lastRun?.errorMessage).toBe("model unavailable");
  });

  it("does not persist sessionFile inside worker.runtime", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: "/tmp/original-session.jsonl",
    });

    const updated = setWorkerRuntimeState({ ...run, workers: [worker] }, worker.workerId, {
      sessionFile: "/tmp/new-session.jsonl",
      sessionId: "session-123",
      lastResumedAt: "2026-04-20T00:00:00.000Z",
    });

    expect(updated.workers[0]?.sessionFile).toBe("/tmp/new-session.jsonl");
    expect(updated.workers[0]?.runtime.sessionId).toBe("session-123");
    expect("sessionFile" in (updated.workers[0]?.runtime ?? {})).toBe(false);
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
