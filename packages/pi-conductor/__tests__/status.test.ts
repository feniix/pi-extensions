import { describe, expect, it } from "vitest";
import { formatRunStatus } from "../extensions/status.js";
import { createEmptyRun, createWorkerRecord } from "../extensions/storage.js";

describe("formatRunStatus", () => {
  it("formats an empty run", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const text = formatRunStatus(run);
    expect(text).toContain("projectKey: abc");
    expect(text).toContain("workers: 0");
  });

  it("includes task, session, pr, and summary staleness details", () => {
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
  });
});
