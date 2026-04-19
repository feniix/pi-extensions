import { execSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createManagedWorktree,
  getCurrentBranch,
  planWorktreePath,
  recreateManagedWorktree,
} from "../extensions/worktrees.js";

describe("worktree helpers", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = execSync("mktemp -d", { encoding: "utf-8" }).trim();
    execSync("git init -b main", { cwd: tempDir, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: tempDir, stdio: "pipe" });
    execSync("git config user.name 'Test User'", { cwd: tempDir, stdio: "pipe" });
    writeFileSync(join(tempDir, "README.md"), "hello");
    execSync("git add README.md", { cwd: tempDir, stdio: "pipe" });
    execSync("git commit -m 'initial commit'", { cwd: tempDir, stdio: "pipe" });
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    const siblingRoot = join(tempDir, "..", ".pi-conductor-worktrees", basename(tempDir));
    if (existsSync(siblingRoot)) {
      rmSync(siblingRoot, { recursive: true, force: true });
    }
  });

  it("gets the current branch from a repo root", () => {
    expect(getCurrentBranch(tempDir)).toBe("main");
  });

  it("plans a worktree path outside the repo root", () => {
    const path = planWorktreePath(tempDir, "backend");
    expect(path).toContain(`.pi-conductor-worktrees/${basename(tempDir)}`);
    expect(path).toContain("backend");
    expect(path.startsWith(tempDir)).toBe(false);
  });

  it("creates a managed worktree on a conductor branch", () => {
    const result = createManagedWorktree(tempDir, {
      workerId: "worker-1",
      workerName: "backend",
    });

    expect(result.branch).toBe("conductor/backend");
    expect(existsSync(result.worktreePath)).toBe(true);

    const branch = execSync("git branch --show-current", {
      cwd: result.worktreePath,
      encoding: "utf-8",
    }).trim();
    expect(branch).toBe("conductor/backend");
  });

  it("recreates a pruned managed worktree on an existing branch", () => {
    const created = createManagedWorktree(tempDir, {
      workerId: "worker-1",
      workerName: "backend",
    });
    rmSync(created.worktreePath, { recursive: true, force: true });

    const recreated = recreateManagedWorktree(tempDir, {
      workerName: "backend",
      branch: created.branch,
    });

    expect(recreated.branch).toBe(created.branch);
    expect(existsSync(recreated.worktreePath)).toBe(true);
  });
});
