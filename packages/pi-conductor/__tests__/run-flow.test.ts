import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  preflightWorkerRunRuntime: vi.fn(),
  runWorkerPromptRuntime: vi.fn(),
}));

vi.mock("../extensions/runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../extensions/runtime.js")>();
  return {
    ...actual,
    preflightWorkerRunRuntime: runtimeMocks.preflightWorkerRunRuntime,
    runWorkerPromptRuntime: runtimeMocks.runWorkerPromptRuntime,
  };
});

import {
  createWorkerForRepo,
  getOrCreateRunForRepo,
  runWorkerForRepo,
  updateWorkerLifecycleForRepo,
  updateWorkerTaskForRepo,
} from "../extensions/conductor.js";

describe("worker run flows", () => {
  let repoDir: string;
  let conductorHome: string;

  beforeEach(() => {
    vi.clearAllMocks();
    runtimeMocks.preflightWorkerRunRuntime.mockResolvedValue(undefined);
    runtimeMocks.runWorkerPromptRuntime.mockResolvedValue({
      status: "success",
      finalText: "implemented status output",
      errorMessage: null,
      sessionId: "run-session-1",
    });

    repoDir = execSync("mktemp -d", { encoding: "utf-8" }).trim();
    conductorHome = mkdtempSync(join(tmpdir(), "pi-conductor-home-"));
    process.env.PI_CONDUCTOR_HOME = conductorHome;

    execSync("git init -b main", { cwd: repoDir, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: repoDir, stdio: "pipe" });
    execSync("git config user.name 'Test User'", { cwd: repoDir, stdio: "pipe" });
    writeFileSync(join(repoDir, "README.md"), "hello\n");
    execSync("git add README.md", { cwd: repoDir, stdio: "pipe" });
    execSync("git commit -m 'initial commit'", { cwd: repoDir, stdio: "pipe" });
  });

  afterEach(() => {
    delete process.env.PI_CONDUCTOR_HOME;
    for (const dir of [repoDir, conductorHome]) {
      if (dir && existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("runs a task in an existing worker session lineage and records success metadata", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    updateWorkerTaskForRepo(repoDir, "backend", "old task");

    const result = await runWorkerForRepo(repoDir, "backend", "implement status output");

    expect(result).toMatchObject({
      workerName: "backend",
      status: "success",
      finalText: "implemented status output",
    });
    expect(runtimeMocks.preflightWorkerRunRuntime).toHaveBeenCalledWith({
      worktreePath: worker.worktreePath,
      sessionFile: worker.sessionFile,
    });
    expect(runtimeMocks.runWorkerPromptRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreePath: worker.worktreePath,
        sessionFile: worker.sessionFile,
        task: "implement status output",
      }),
    );

    const persisted = getOrCreateRunForRepo(repoDir).workers[0];
    expect(persisted?.lifecycle).toBe("idle");
    expect(persisted?.currentTask).toBe("implement status output");
    expect(persisted?.lastRun).toMatchObject({
      task: "implement status output",
      status: "success",
      errorMessage: null,
      sessionId: "run-session-1",
    });
  });

  it("fails fast on preflight without mutating currentTask or lifecycle", async () => {
    await createWorkerForRepo(repoDir, "backend");
    updateWorkerTaskForRepo(repoDir, "backend", "old task");
    runtimeMocks.preflightWorkerRunRuntime.mockRejectedValueOnce(new Error("No usable model configured"));

    await expect(runWorkerForRepo(repoDir, "backend", "new task")).rejects.toThrow("No usable model configured");

    const persisted = getOrCreateRunForRepo(repoDir).workers[0];
    expect(persisted?.currentTask).toBe("old task");
    expect(persisted?.lifecycle).toBe("idle");
    expect(persisted?.lastRun).toBeNull();
    expect(runtimeMocks.runWorkerPromptRuntime).not.toHaveBeenCalled();
  });

  it("persists the execution session id as soon as the runtime session is created", async () => {
    await createWorkerForRepo(repoDir, "backend");
    runtimeMocks.runWorkerPromptRuntime.mockImplementationOnce(async ({ onSessionReady }) => {
      await onSessionReady?.("run-session-early");
      const duringRun = getOrCreateRunForRepo(repoDir).workers[0];
      expect(duringRun?.lifecycle).toBe("running");
      expect(duringRun?.lastRun?.finishedAt).toBeNull();
      expect(duringRun?.lastRun?.sessionId).toBe("run-session-early");
      return {
        status: "success",
        finalText: "done",
        errorMessage: null,
        sessionId: "run-session-early",
      };
    });

    await runWorkerForRepo(repoDir, "backend", "record session id early");
  });

  it("marks errored runs blocked and persists the run error message", async () => {
    await createWorkerForRepo(repoDir, "backend");
    runtimeMocks.runWorkerPromptRuntime.mockResolvedValueOnce({
      status: "error",
      finalText: null,
      errorMessage: "model crashed",
      sessionId: "run-session-2",
    });

    const result = await runWorkerForRepo(repoDir, "backend", "dangerous task");

    expect(result.status).toBe("error");
    const persisted = getOrCreateRunForRepo(repoDir).workers[0];
    expect(persisted?.lifecycle).toBe("blocked");
    expect(persisted?.lastRun).toMatchObject({
      status: "error",
      errorMessage: "model crashed",
      sessionId: "run-session-2",
    });
  });

  it("returns aborted runs to idle and preserves aborted metadata", async () => {
    await createWorkerForRepo(repoDir, "backend");
    runtimeMocks.runWorkerPromptRuntime.mockResolvedValueOnce({
      status: "aborted",
      finalText: "stopped early",
      errorMessage: null,
      sessionId: "run-session-3",
    });

    const result = await runWorkerForRepo(repoDir, "backend", "abortable task");

    expect(result.status).toBe("aborted");
    const persisted = getOrCreateRunForRepo(repoDir).workers[0];
    expect(persisted?.lifecycle).toBe("idle");
    expect(persisted?.lastRun).toMatchObject({
      task: "abortable task",
      status: "aborted",
      sessionId: "run-session-3",
    });
  });

  it("rejects already running workers and workers with missing session files", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    updateWorkerLifecycleForRepo(repoDir, "backend", "running");
    await expect(runWorkerForRepo(repoDir, "backend", "task")).rejects.toThrow(/already running/i);

    updateWorkerLifecycleForRepo(repoDir, "backend", "idle");
    if (worker.sessionFile) {
      unlinkSync(worker.sessionFile);
    }
    await expect(runWorkerForRepo(repoDir, "backend", "task")).rejects.toThrow(/recover the worker first/i);
  });
});
