import { describe, expect, it } from "vitest";
import { formatRunStatus } from "../extensions/status.js";
import {
  addTask,
  addWorker,
  assignTaskToWorker,
  createEmptyRun,
  createTaskRecord,
  createWorkerRecord,
} from "../extensions/storage.js";

describe("formatRunStatus", () => {
  it("formats an empty run", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const text = formatRunStatus(run);
    expect(text).toContain("projectKey: abc");
    expect(text).toContain("workers: 0");
    expect(text).toContain("tasks: 0");
    expect(text).toContain("runs: 0");
    expect(text).toContain("events: 0");
  });

  it("includes concise durable task resource status", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: "/tmp/session.jsonl",
    });
    const task = createTaskRecord({ taskId: "task-1", title: "Add ledger", prompt: "Implement tasks" });
    const withTask = assignTaskToWorker(addTask(addWorker(run, worker), task), task.taskId, worker.workerId);

    const text = formatRunStatus(withTask);

    expect(text).toContain("tasks: 1");
    expect(text).toContain("events: 3");
    expect(text).toContain(
      "- task Add ledger [task-1] state=assigned assignedWorker=worker-1 activeRun=none latestProgress=none",
    );
  });

  it("includes task, session, pr, summary, and run details", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: "/tmp/session.jsonl",
    });
    worker.currentTask = "implement status command";
    worker.summary.text = "Half done";
    worker.summary.stale = true;
    worker.pr.url = "https://github.com/example/repo/pull/123";
    worker.runtime.sessionId = "session-123";
    worker.runtime.lastResumedAt = "2026-04-20T00:00:00.000Z";

    worker.pr.commitSucceeded = true;
    worker.pr.pushSucceeded = true;
    worker.pr.prCreationAttempted = true;
    worker.lastRun = {
      task: "implement status command",
      status: "success",
      startedAt: "2026-04-20T01:00:00.000Z",
      finishedAt: "2026-04-20T01:05:00.000Z",
      errorMessage: null,
      sessionId: "run-session-123",
    };

    const text = formatRunStatus({ ...run, workers: [worker] });
    expect(text).toContain("health=stale");
    expect(text).toContain("task=implement status command");
    expect(text).toContain("worktree=/tmp/repo/.worktrees/backend");
    expect(text).toContain("session=/tmp/session.jsonl");
    expect(text).toContain("runtime=session_manager");
    expect(text).toContain("sessionId=session-123");
    expect(text).toContain("lastResumedAt=2026-04-20T00:00:00.000Z");
    expect(text).toContain("pr=https://github.com/example/repo/pull/123");
    expect(text).toContain("commit=true");
    expect(text).toContain("push=true");
    expect(text).toContain("prAttempted=true");
    expect(text).toContain("recoverable=false");
    expect(text).toContain("summary=stale: Half done");
    expect(text).toContain("lastRun=success");
    expect(text).toContain("runSessionId=run-session-123");
    expect(text).toContain("runStartedAt=2026-04-20T01:00:00.000Z");
    expect(text).toContain("runFinishedAt=2026-04-20T01:05:00.000Z");
  });

  it("shows active running runs distinctly", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: "/tmp/session.jsonl",
    });
    worker.lifecycle = "running";
    worker.lastRun = {
      task: "ship feature",
      status: null,
      startedAt: "2026-04-20T02:00:00.000Z",
      finishedAt: null,
      errorMessage: null,
      sessionId: "run-session-456",
    };

    const text = formatRunStatus({ ...run, workers: [worker] });
    expect(text).toContain("lastRun=running");
    expect(text).toContain("runFinishedAt=none");
  });
});
