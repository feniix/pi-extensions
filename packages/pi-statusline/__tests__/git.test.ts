import { describe, expect, it } from "vitest";
import {
  getWorktreeLabelForPath,
  isLinkedWorktreeGitDir,
  parseDirtyCountFromPorcelain,
  parseWorktreeListPorcelain,
} from "../extensions/git.js";

describe("pi-statusline git helpers", () => {
  it("counts dirty paths from porcelain output", () => {
    const output = " M file-a.ts\n?? file-b.ts\nA  file-c.ts\n";
    expect(parseDirtyCountFromPorcelain(output)).toBe(3);
  });

  it("parses porcelain worktree output", () => {
    const output = [
      "worktree /repo",
      "HEAD abcdef",
      "branch refs/heads/main",
      "",
      "worktree /repo-feature",
      "HEAD 123456",
      "branch refs/heads/feature/test",
      "",
    ].join("\n");

    expect(parseWorktreeListPorcelain(output)).toEqual([
      { path: "/repo", branch: "refs/heads/main" },
      { path: "/repo-feature", branch: "refs/heads/feature/test" },
    ]);
  });

  it("detects linked worktree git dirs", () => {
    expect(isLinkedWorktreeGitDir(".git/worktrees/feature")).toBe(true);
    expect(isLinkedWorktreeGitDir("/tmp/repo/.git/worktrees/feature")).toBe(true);
    expect(isLinkedWorktreeGitDir(".git")).toBe(false);
  });

  it("returns branch basename for linked worktree paths", () => {
    const label = getWorktreeLabelForPath(
      [
        { path: "/repo", branch: "refs/heads/main" },
        { path: "/repo-feature", branch: "refs/heads/feature/test" },
      ],
      "/repo-feature",
      ".git/worktrees/repo-feature",
    );

    expect(label).toBe("test");
  });

  it('returns "main" for the main worktree', () => {
    const label = getWorktreeLabelForPath([{ path: "/repo", branch: "refs/heads/main" }], "/repo", ".git");
    expect(label).toBe("main");
  });
});
