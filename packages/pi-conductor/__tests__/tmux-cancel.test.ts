import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CancelTmuxResult = { cleanupStatus: "succeeded" | "failed"; diagnostic: string | null };

const tmuxMocks = vi.hoisted(() => ({
  cancelTmuxRuntime: vi.fn(
    async (): Promise<CancelTmuxResult> => ({
      cleanupStatus: "succeeded",
      diagnostic: "killed detached tmux",
    }),
  ),
}));

vi.mock("../extensions/tmux-runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../extensions/tmux-runtime.js")>();
  return { ...actual, cancelTmuxRuntime: tmuxMocks.cancelTmuxRuntime };
});

import {
  assignTaskForRepo,
  cancelActiveWorkForRepo,
  cancelTaskRunForRepo,
  createTaskForRepo,
  createWorkerForRepo,
  getOrCreateRunForRepo,
  startTaskRunForRepo,
} from "../extensions/conductor.js";
import { writeRun } from "../extensions/storage.js";

describe("tmux durable cancellation", () => {
  let repoDir: string;
  let conductorHome: string;

  beforeEach(() => {
    vi.clearAllMocks();
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
      if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  });

  async function createPersistedTmuxRun() {
    const worker = await createWorkerForRepo(repoDir, "tmux-worker");
    const task = createTaskForRepo(repoDir, { title: "Detached tmux", prompt: "Run visibly" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId });
    const project = getOrCreateRunForRepo(repoDir);
    writeRun({
      ...project,
      runs: project.runs.map((run) =>
        run.runId === started.run.runId
          ? {
              ...run,
              runtime: {
                ...run.runtime,
                mode: "tmux",
                cleanupStatus: "pending",
                tmux: { socketPath: "/tmp/tmux.sock", sessionName: "detached", windowId: "@1", paneId: "%2" },
              },
            }
          : run,
      ),
    });
    return started;
  }

  it("kills persisted tmux runtime resources when no live abort handle exists", async () => {
    const started = await createPersistedTmuxRun();

    const canceled = await cancelTaskRunForRepo(repoDir, { runId: started.run.runId, reason: "stop detached" });

    expect(tmuxMocks.cancelTmuxRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: expect.objectContaining({ mode: "tmux" }) }),
    );
    expect(canceled.runs[0]).toMatchObject({
      status: "aborted",
      runtime: { cleanupStatus: "succeeded", diagnostics: expect.arrayContaining(["killed detached tmux"]) },
    });
  });

  it("keeps workers out of the idle pool when tmux cleanup fails", async () => {
    tmuxMocks.cancelTmuxRuntime.mockResolvedValueOnce({
      cleanupStatus: "failed" as const,
      diagnostic: "pane command verification failed before cancel: zsh",
    });
    const started = await createPersistedTmuxRun();

    const canceled = await cancelTaskRunForRepo(repoDir, { runId: started.run.runId, reason: "stop detached" });

    expect(canceled.runs[0]).toMatchObject({ runtime: { cleanupStatus: "failed" } });
    expect(canceled.workers[0]).toMatchObject({ lifecycle: "broken", recoverable: true });
  });

  it("kills persisted tmux runtime resources during bulk active-work cancellation", async () => {
    await createPersistedTmuxRun();

    const canceled = await cancelActiveWorkForRepo(repoDir, { reason: "stop all detached" });

    expect(tmuxMocks.cancelTmuxRuntime).toHaveBeenCalledTimes(1);
    expect(canceled.project.runs[0]).toMatchObject({
      status: "aborted",
      runtime: { cleanupStatus: "succeeded", diagnostics: expect.arrayContaining(["killed detached tmux"]) },
    });
  });
});
