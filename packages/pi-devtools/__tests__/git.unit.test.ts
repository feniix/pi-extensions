import { afterEach, describe, expect, it, vi } from "vitest";

const { execSyncMock } = vi.hoisted(() => ({
  execSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execSync: execSyncMock,
}));

import {
  compareVersions,
  execGh,
  execGit,
  getCurrentBranch,
  getGitContext,
  getTagInfo,
  getWorkingTreeStatus,
  getWorktreeContext,
  isGitRepo,
  parseVersion,
  parseWorktreeList,
} from "../extensions/git.js";

describe("pi-devtools git unit helpers", () => {
  afterEach(() => {
    execSyncMock.mockReset();
  });

  it("parses and compares versions", () => {
    expect(parseVersion("v1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion("2.0.1")).toEqual([2, 0, 1]);
    expect(compareVersions([1, 2, 0], [1, 1, 9])).toBeGreaterThan(0);
    expect(compareVersions([1, 2], [1, 2, 0])).toBe(0);
  });

  it("forwards an explicit cwd to Git and GitHub child processes", () => {
    execSyncMock.mockReturnValue("ok\n");

    expect(execGit("git status", "/tmp/active git")).toBe("ok");
    expect(execGh("gh pr view", "/tmp/active git")).toBe("ok");
    expect(execSyncMock).toHaveBeenNthCalledWith(1, "git status", expect.objectContaining({ cwd: "/tmp/active git" }));
    expect(execSyncMock).toHaveBeenNthCalledWith(2, "gh pr view", expect.objectContaining({ cwd: "/tmp/active git" }));
  });

  it("detects whether the supplied cwd is inside a git repository", () => {
    execSyncMock.mockReturnValueOnce("true\n");
    expect(isGitRepo("/tmp/repository")).toBe(true);
    expect(execSyncMock).toHaveBeenCalledWith(
      "git rev-parse --is-inside-work-tree",
      expect.objectContaining({ cwd: "/tmp/repository" }),
    );

    execSyncMock.mockImplementationOnce(() => {
      throw new Error("not a repo");
    });
    expect(isGitRepo()).toBe(false);
  });

  it("parses NUL-delimited worktree records without losing spaces or state reasons", () => {
    const output = [
      "worktree /tmp/repo with spaces",
      "HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "branch refs/heads/main",
      "",
      "worktree /tmp/repo-linked",
      "HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "detached",
      "locked reason with spaces",
      "prunable stale metadata reason",
      "",
    ].join("\0");

    expect(parseWorktreeList(output)).toEqual([
      {
        worktreeRoot: "/tmp/repo with spaces",
        head: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        branch: "refs/heads/main",
        detached: false,
        locked: false,
        prunable: false,
      },
      {
        worktreeRoot: "/tmp/repo-linked",
        head: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        detached: true,
        locked: true,
        lockedReason: "reason with spaces",
        prunable: true,
        prunableReason: "stale metadata reason",
      },
    ]);
  });

  it("selects the active worktree by canonical root and exposes detached HEAD topology", () => {
    execSyncMock
      .mockReturnValueOnce("/tmp/project/same\n")
      .mockReturnValueOnce("/tmp/project/.git/worktrees/same\n")
      .mockReturnValueOnce("/tmp/project/.git\n")
      .mockReturnValueOnce(
        [
          "worktree /tmp/other/same",
          "HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "branch refs/heads/other",
          "",
          "worktree /tmp/project/same",
          "HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          "detached",
          "",
        ].join("\0"),
      );

    expect(getWorktreeContext("/tmp/project/same/subdirectory")).toEqual(
      expect.objectContaining({
        worktreeRoot: "/tmp/project/same",
        privateGitDir: "/tmp/project/.git/worktrees/same",
        gitDir: "/tmp/project/.git/worktrees/same",
        commonGitDir: "/tmp/project/.git",
        isLinkedWorktree: true,
        head: {
          commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          detached: true,
        },
        activeWorktreeIndex: 1,
      }),
    );
  });

  it("returns detached head branch labels when branch name is empty", () => {
    execSyncMock.mockReturnValueOnce("\n").mockReturnValueOnce("abc123\n");
    expect(getCurrentBranch()).toBe("Detached HEAD at abc123");
  });

  it("formats working tree status from porcelain output", () => {
    execSyncMock.mockReturnValueOnce(" M file1\n?? new.txt\n M file2\n");
    expect(getWorkingTreeStatus()).toBe("2 modified, 1 untracked");
  });

  it("formats tag info with unreleased commit count", () => {
    execSyncMock.mockReturnValueOnce("v1.0.0\nv1.2.0\nv1.1.5\n").mockReturnValueOnce("3\n");
    expect(getTagInfo()).toBe("Tag: v1.2.0 (3 unreleased commits)");
  });

  it("returns no tags message when tag list is empty", () => {
    execSyncMock.mockReturnValueOnce("\n");
    expect(getTagInfo()).toBe("No version tags found");
  });

  it("builds git context from branch, status, and tags", () => {
    execSyncMock
      .mockReturnValueOnce("true\n")
      .mockReturnValueOnce("feature/coverage\n")
      .mockReturnValueOnce(" M file.ts\n")
      .mockReturnValueOnce("v1.0.0\n")
      .mockReturnValueOnce("2\n");

    expect(getGitContext()).toBe(
      "[devtools] Branch: feature/coverage | Status: 1 modified | Tag: v1.0.0 (2 unreleased commits)",
    );
  });

  it("wraps git and gh command failures with clearer messages", () => {
    execSyncMock.mockImplementationOnce(() => {
      throw new Error("git blew up");
    });
    expect(() => execGit("git status")).toThrow("Git error: git blew up");

    execSyncMock.mockImplementationOnce(() => {
      throw new Error("gh blew up");
    });
    expect(() => execGh("gh pr view")).toThrow("gh error: gh blew up");
  });
});
