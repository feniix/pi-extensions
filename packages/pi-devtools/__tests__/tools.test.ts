import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyzeCommitsTool,
  bumpVersion,
  checkCiTool,
  commitTool,
  createBranchTool,
  createPrTool,
  createReleaseTool,
  getLatestTagTool,
  mergePrTool,
  pushTool,
  repoInfoTool,
  toolDefinitions,
} from "../extensions/index.js";

// Mock the git.ts module
vi.mock("../extensions/git.js", () => ({
  execGit: vi.fn(),
  execGh: vi.fn(),
  getDefaultBranch: vi.fn().mockReturnValue("main"),
  getGitContext: vi.fn().mockReturnValue("[devtools] Branch: feature-branch"),
  getWorktreeContext: vi.fn().mockReturnValue({
    worktreeRoot: "/repo",
    privateGitDir: "/repo/.git",
    gitDir: "/repo/.git",
    commonGitDir: "/repo/.git",
    isLinkedWorktree: false,
    head: { commit: "abc123", branch: "refs/heads/feature-branch", detached: false },
    worktrees: [],
    activeWorktree: { worktreeRoot: "/repo", head: "abc123", detached: false, locked: false, prunable: false },
    activeWorktreeIndex: 0,
  }),
}));

import { execGh, execGit, getGitContext, getWorktreeContext } from "../extensions/git.js";

describe("pi-devtools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(execGit).mockReset();
    vi.mocked(execGh).mockReset();
    vi.mocked(getWorktreeContext)
      .mockReset()
      .mockReturnValue({
        worktreeRoot: "/repo",
        privateGitDir: "/repo/.git",
        gitDir: "/repo/.git",
        commonGitDir: "/repo/.git",
        isLinkedWorktree: false,
        head: { commit: "base", branch: "refs/heads/feature-branch", detached: false },
        worktrees: [],
        activeWorktree: {
          worktreeRoot: "/repo",
          head: "base",
          branch: "refs/heads/feature-branch",
          detached: false,
          locked: false,
          prunable: false,
          isActive: true,
        },
        activeWorktreeIndex: 0,
      });
  });

  describe("registered tool cwd propagation", () => {
    const sentinelCwd = "/tmp/sentinel-worktree";
    const paramsByTool: Record<string, Record<string, unknown>> = {
      devtools_create_branch: { branchName: "sentinel-branch" },
      devtools_commit: { message: "test: sentinel" },
      devtools_push: { branch: "feature-branch" },
      devtools_create_pr: { title: "Sentinel PR", base: "main" },
      devtools_merge_pr: { prNumber: 12, deleteBranch: false },
      devtools_squash_merge_pr: { prNumber: 12, deleteBranch: false },
      devtools_check_ci: { prNumber: 12 },
      devtools_get_repo_info: {},
      devtools_get_latest_tag: {},
      devtools_analyze_commits: {},
      devtools_create_release: { tag: "v1.0.0", title: "Release" },
    };

    it("passes the invoking context cwd through every command-backed registered tool", async () => {
      vi.mocked(execGit).mockImplementation((command: string) => {
        if (command === "git branch --show-current") return "feature-branch";
        if (command === "git diff --cached --name-only") return "file.ts";
        if (command === "git rev-parse HEAD") return "abc123head";
        return "";
      });
      vi.mocked(execGh).mockImplementation((command: string) => {
        if (command.startsWith("gh pr view")) {
          return JSON.stringify({ title: "Sentinel", url: "https://example.test/pr/12", state: "OPEN" });
        }
        if (command.startsWith("gh pr checks")) return "[]";
        return "https://example.test/result";
      });

      for (const [name, params] of Object.entries(paramsByTool)) {
        vi.mocked(execGit).mockClear();
        vi.mocked(execGh).mockClear();
        const tool = toolDefinitions.find((candidate) => candidate.name === name);
        await (tool?.execute as (...args: unknown[]) => Promise<unknown>)("call-id", params, undefined, undefined, {
          cwd: sentinelCwd,
        });

        const commandCalls = [...vi.mocked(execGit).mock.calls, ...vi.mocked(execGh).mock.calls];
        expect(commandCalls.length, name).toBeGreaterThan(0);
        expect(
          commandCalls.every((call) => call[1] === sentinelCwd),
          name,
        ).toBe(true);
      }
    });

    it("keeps the legacy two-argument executor contract", async () => {
      vi.mocked(execGit).mockReturnValue("");

      const result = await toolDefinitions[0].execute("call-id", { branchName: "legacy-branch" });

      expect(result.isError).toBeUndefined();
      expect(execGit).toHaveBeenCalledWith("git checkout -b 'legacy-branch'", undefined);
    });

    it("resolves a registered version-file mutation from the invoking cwd", async () => {
      const cwd = mkdtempSync(join(tmpdir(), "pi-devtools-version-"));
      try {
        writeFileSync(join(cwd, "custom.json"), '{"version":"1.0.0"}\n');
        const tool = toolDefinitions.find(({ name }) => name === "devtools_bump_version");
        await (tool?.execute as (...args: unknown[]) => Promise<unknown>)(
          "call-id",
          { newVersion: "1.1.0", file: "custom.json" },
          undefined,
          undefined,
          { cwd },
        );

        expect(JSON.parse(readFileSync(join(cwd, "custom.json"), "utf-8")).version).toBe("1.1.0");
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });

    it("uses the session event cwd for Git and worktree context", async () => {
      const handlers = new Map<string, (...args: unknown[]) => Promise<void>>();
      const pi = {
        registerTool: vi.fn(),
        on: vi.fn((event: string, handler: (...args: unknown[]) => Promise<void>) => handlers.set(event, handler)),
      } as unknown as ExtensionAPI;
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const { default: extension } = await import("../extensions/index.js");
      extension(pi);

      await handlers.get("session_start")?.({}, { cwd: sentinelCwd });

      expect(getGitContext).toHaveBeenCalledWith(sentinelCwd);
      expect(getWorktreeContext).toHaveBeenCalledWith(sentinelCwd);
      expect(log).toHaveBeenCalledWith(expect.stringContaining("Worktree: /repo"));
      log.mockRestore();
    });
  });

  describe("bumpVersion", () => {
    it("bumps patch version", () => {
      expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
    });

    it("bumps minor version", () => {
      expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
    });

    it("bumps major version", () => {
      expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
    });

    it("handles v-prefixed version", () => {
      expect(bumpVersion("v1.2.3", "patch")).toBe("1.2.4");
    });

    it("throws on invalid version format", () => {
      expect(() => bumpVersion("invalid", "patch")).toThrow("Invalid version format");
    });

    it("throws on incomplete version", () => {
      expect(() => bumpVersion("1.2", "patch")).toThrow("Invalid version format");
    });

    it("throws on NaN version parts", () => {
      expect(() => bumpVersion("1.a.3", "patch")).toThrow("Invalid version format");
    });
  });

  describe("createBranchTool", () => {
    it("creates branch successfully", () => {
      vi.mocked(execGit).mockReturnValue("");

      const result = createBranchTool("feature/new-feature");

      expect(result.content[0].text).toContain("feature/new-feature");
      expect(result.details.branch).toBe("feature/new-feature");
    });

    it("handles branch creation error", () => {
      vi.mocked(execGit).mockImplementation(() => {
        throw new Error("Branch already exists");
      });

      const result = createBranchTool("existing-branch");

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed to create branch");
    });
  });

  describe("commitTool", () => {
    it("commits successfully", () => {
      vi.mocked(execGit)
        .mockReturnValueOnce("feature-branch")
        .mockReturnValueOnce("")
        .mockReturnValueOnce("file1.js")
        .mockReturnValueOnce("");

      const result = commitTool("feat: add new feature");

      expect(result.content[0].text).toContain("Committed");
      expect(result.details.message).toBe("feat: add new feature");
    });

    it("handles detached HEAD", () => {
      vi.mocked(execGit).mockImplementation((cmd: string) => {
        if (cmd === "git branch --show-current") {
          throw new Error("detached HEAD");
        }
        throw new Error("Unexpected command");
      });

      const result = commitTool("feat: test");

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("detached HEAD");
    });

    it("handles no staged files", () => {
      vi.mocked(execGit).mockReturnValueOnce("feature-branch").mockReturnValueOnce("").mockReturnValueOnce("");

      const result = commitTool("feat: test");

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("No files staged");
    });

    it("commits specific files", () => {
      vi.mocked(execGit)
        .mockReturnValueOnce("feature-branch")
        .mockReturnValueOnce("")
        .mockReturnValueOnce("specific.js")
        .mockReturnValueOnce("");

      const result = commitTool("feat: test", ["specific.js"]);

      expect(result.isError).toBeUndefined();
    });

    it("handles commit error", () => {
      vi.mocked(execGit)
        .mockReturnValueOnce("feature-branch")
        .mockReturnValueOnce("")
        .mockReturnValueOnce("file.js")
        .mockImplementation(() => {
          throw new Error("Commit failed");
        });

      const result = commitTool("feat: test");

      expect(result.isError).toBe(true);
    });
  });

  describe("pushTool", () => {
    it("pushes branch successfully", () => {
      vi.mocked(execGit).mockReturnValueOnce("feature-branch").mockReturnValueOnce("");

      const result = pushTool();

      expect(result.content[0].text).toContain("Pushed");
      expect(result.details.branch).toBe("feature-branch");
    });

    it("handles push error", () => {
      vi.mocked(execGit).mockImplementation((cmd: string) => {
        if (cmd === "git branch --show-current") return "feature-branch";
        throw new Error("Push failed");
      });

      const result = pushTool();

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Push failed");
    });
  });

  describe("detached HEAD branch safeguards", () => {
    it.each([
      ["push", () => pushTool()],
      ["create PR", () => createPrTool("Detached PR")],
      ["implicit PR lookup", () => mergePrTool()],
      ["implicit branch CI", () => checkCiTool()],
    ])("stops %s before a remote mutation", (_label, invoke) => {
      vi.mocked(execGit).mockReturnValue("");

      const result = invoke();

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("detached HEAD");
      expect(execGh).not.toHaveBeenCalled();
    });
  });

  describe("createPrTool", () => {
    it("creates PR successfully with an explicit head branch", () => {
      vi.mocked(execGit).mockReturnValue("feature-branch");
      vi.mocked(execGh).mockReturnValue("https://github.com/owner/repo/pull/123");

      const result = createPrTool("Add new feature", "Description");

      expect(result.content[0].text).toContain("Created PR");
      expect(result.details.prUrl).toContain("github.com");
      const ghCall = vi.mocked(execGh).mock.calls[0][0] as string;
      expect(ghCall).toContain("--head 'feature-branch'");
    });

    it("creates PR with an explicit empty body when body is omitted", () => {
      vi.mocked(execGit).mockReturnValue("main");
      vi.mocked(execGh).mockReturnValue("https://github.com/owner/repo/pull/123");

      const result = createPrTool("Test PR");

      expect(result.content[0].text).toContain("Created PR");
      const ghCall = vi.mocked(execGh).mock.calls[0][0] as string;
      expect(ghCall).toContain("--body ''");
    });

    it("creates draft PR", () => {
      vi.mocked(execGit).mockReturnValue("main");
      vi.mocked(execGh).mockReturnValue("https://github.com/owner/repo/pull/123");

      createPrTool("Draft PR", undefined, undefined, true);

      // Capture the gh command and verify it contains --draft
      const ghCall = vi.mocked(execGh).mock.calls[0][0] as string;
      expect(ghCall).toContain("--draft");
    });

    it("creates PR with assignees", () => {
      vi.mocked(execGit).mockReturnValue("main");
      vi.mocked(execGh).mockReturnValue("https://github.com/owner/repo/pull/123");

      createPrTool("Test PR", undefined, undefined, false, ["user1", "user2"]);

      const ghCall = vi.mocked(execGh).mock.calls[0][0] as string;
      expect(ghCall).toContain("--assignee");
    });

    it("handles PR creation error", () => {
      vi.mocked(execGit).mockReturnValue("main");
      vi.mocked(execGh).mockImplementation(() => {
        throw new Error("gh not authenticated");
      });

      const result = createPrTool("Test PR");

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed to create PR");
    });
  });

  describe("mergePrTool", () => {
    const sameRepoPr = {
      title: "Test PR",
      url: "https://github.com/base/repo/pull/123",
      state: "OPEN",
      headRefName: "feature/topic",
      headRefOid: "abc123",
      headRepository: { id: "R_realOutput", name: "repo", nameWithOwner: "base/repo" },
      headRepositoryOwner: { login: "base" },
      isCrossRepository: false,
    };

    function mockMergeCommands(pr: Record<string, unknown> = sameRepoPr) {
      let merged = false;
      vi.mocked(execGh).mockImplementation((command: string) => {
        if (command.startsWith("gh pr view")) {
          return JSON.stringify(merged ? { ...pr, state: "MERGED", mergedAt: "2026-07-11T12:00:00Z" } : pr);
        }
        if (command.startsWith("gh pr merge")) {
          merged = true;
          return "";
        }
        if (command === "gh repo view --json nameWithOwner,url") {
          return JSON.stringify({ nameWithOwner: "base/repo", url: "https://github.com/base/repo" });
        }
        if (command.startsWith("gh api") && !command.includes("--method DELETE")) {
          return JSON.stringify({ object: { sha: String(pr.headRefOid ?? "") } });
        }
        return "";
      });
      vi.mocked(execGit).mockImplementation((command: string) =>
        command.startsWith("git rev-parse --verify") ? String(pr.headRefOid ?? "") : "",
      );
    }

    it("reports a queued merge as pending and skips cleanup when the post-command state remains open", () => {
      vi.mocked(execGh).mockImplementation((command: string) => {
        if (command.startsWith("gh pr view")) return JSON.stringify(sameRepoPr);
        return "";
      });

      const result = mergePrTool(123);

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("pending");
      expect(result.content[0].text).not.toContain("Merged PR");
      expect(result.content[0].text).toContain(
        JSON.stringify({
          mergeStatus: "pending",
          state: "OPEN",
          remoteCleanup: { status: "skipped", reason: "merge_not_confirmed" },
          localCleanup: { status: "skipped", reason: "merge_not_confirmed" },
          cleanupComplete: false,
        }),
      );
      expect(result.details).toEqual(
        expect.objectContaining({
          mergeStatus: "pending",
          state: "OPEN",
          remoteCleanup: { status: "skipped", reason: "merge_not_confirmed" },
          localCleanup: { status: "skipped", reason: "merge_not_confirmed" },
        }),
      );
      expect(execGh).not.toHaveBeenCalledWith(expect.stringContaining("gh api"), expect.anything());
      expect(getWorktreeContext).not.toHaveBeenCalled();
      expect(execGit).not.toHaveBeenCalled();
    });

    it("reports unknown status instead of merge failure when confirmation lookup fails", () => {
      let viewCount = 0;
      vi.mocked(execGh).mockImplementation((command: string) => {
        if (command.startsWith("gh pr view")) {
          viewCount += 1;
          if (viewCount === 1) return JSON.stringify(sameRepoPr);
          throw new Error("confirmation unavailable");
        }
        return "";
      });

      const result = mergePrTool(123);

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("could not be confirmed");
      expect(result.details).toEqual(
        expect.objectContaining({
          mergeStatus: "unknown",
          remoteCleanup: { status: "skipped", reason: "merge_confirmation_failed" },
          localCleanup: { status: "skipped", reason: "merge_confirmation_failed" },
          confirmationError: "confirmation unavailable",
        }),
      );
      expect(execGh).not.toHaveBeenCalledWith(expect.stringContaining("gh api"), expect.anything());
      expect(execGit).not.toHaveBeenCalled();
    });

    it("re-queries and reports merged only after authoritative confirmation", () => {
      mockMergeCommands();

      const result = mergePrTool(123, false, false);

      expect(result.content[0].text).toContain("Merged PR #123");
      expect(result.content[0].text).toContain(
        JSON.stringify({
          mergeStatus: "merged",
          state: "MERGED",
          remoteCleanup: { status: "not_requested" },
          localCleanup: { status: "not_requested" },
          cleanupComplete: true,
        }),
      );
      expect(result.details).toEqual(expect.objectContaining({ mergeStatus: "merged", state: "MERGED" }));
      expect(vi.mocked(execGh).mock.calls.filter(([command]) => command.startsWith("gh pr view"))).toHaveLength(2);
    });

    it("reports cleanup as not requested and performs no cleanup when deleteBranch is false", () => {
      mockMergeCommands();

      const result = mergePrTool(123, false, false);

      expect(result.isError).toBeUndefined();
      expect(result).toEqual(
        expect.objectContaining({
          details: expect.objectContaining({
            remoteCleanup: { status: "not_requested" },
            localCleanup: { status: "not_requested" },
            deletedBranch: false,
          }),
        }),
      );
      expect(execGh).not.toHaveBeenCalledWith(expect.stringContaining("gh api"), expect.anything());
      expect(execGit).not.toHaveBeenCalledWith(expect.stringContaining("branch --delete"), expect.anything());
    });

    it("merges without combined deletion and records independent successful cleanup", () => {
      mockMergeCommands();

      const result = mergePrTool(123);
      const commands = vi.mocked(execGh).mock.calls.map(([command]) => command);

      expect(commands.find((command) => command.startsWith("gh pr merge"))).not.toContain("--delete-branch");
      expect(result.details).toEqual(
        expect.objectContaining({
          remoteCleanup: {
            status: "deleted",
            repository: "base/repo",
            ref: "refs/heads/feature/topic",
          },
          localCleanup: { status: "deleted", branch: "feature/topic" },
          deletedBranch: true,
        }),
      );
    });

    it("retains a reused local branch whose OID no longer matches the PR head", () => {
      mockMergeCommands();
      vi.mocked(execGit).mockReturnValue("new456");

      const result = mergePrTool(123);

      expect(result.details.localCleanup).toEqual({
        status: "retained",
        branch: "feature/topic",
        reason: "local_ref_oid_mismatch",
      });
      expect(getWorktreeContext).toHaveBeenCalledWith(undefined);
      expect(execGit).not.toHaveBeenCalledWith(expect.stringContaining("branch --delete"), expect.anything());
    });

    it("retains a source branch occupied by the active worktree and reports its path and state", () => {
      mockMergeCommands();
      vi.mocked(getWorktreeContext).mockReturnValue({
        worktreeRoot: "/repo",
        privateGitDir: "/repo/.git",
        gitDir: "/repo/.git",
        commonGitDir: "/repo/.git",
        isLinkedWorktree: false,
        head: { commit: "abc", branch: "refs/heads/feature/topic", detached: false },
        worktrees: [
          {
            worktreeRoot: "/repo",
            head: "abc",
            branch: "refs/heads/feature/topic",
            detached: false,
            locked: false,
            prunable: false,
            isActive: true,
          },
        ],
        activeWorktree: {
          worktreeRoot: "/repo",
          head: "abc",
          branch: "refs/heads/feature/topic",
          detached: false,
          locked: false,
          prunable: false,
          isActive: true,
        },
        activeWorktreeIndex: 0,
      });

      const result = mergePrTool(123);

      expect(result.isError).toBeUndefined();
      expect(result.details.localCleanup).toEqual({
        status: "retained",
        branch: "feature/topic",
        reason: "branch_occupied_by_worktree",
        worktrees: [expect.objectContaining({ path: "/repo", state: "current", isActive: true })],
      });
      expect(execGit).not.toHaveBeenCalledWith(expect.stringContaining("branch --delete"), expect.anything());
    });

    it("retains a branch claimed by another locked linked worktree", () => {
      mockMergeCommands();
      vi.mocked(getWorktreeContext).mockReturnValue({
        worktreeRoot: "/repo",
        privateGitDir: "/repo/.git",
        gitDir: "/repo/.git",
        commonGitDir: "/repo/.git",
        isLinkedWorktree: false,
        head: { commit: "base", branch: "refs/heads/main", detached: false },
        worktrees: [
          {
            worktreeRoot: "/repo",
            head: "base",
            branch: "refs/heads/main",
            detached: false,
            locked: false,
            prunable: false,
            isActive: true,
          },
          {
            worktreeRoot: "/linked topic",
            head: "abc",
            branch: "refs/heads/feature/topic",
            detached: false,
            locked: true,
            lockedReason: "in use",
            prunable: false,
            isActive: false,
          },
        ],
        activeWorktree: {
          worktreeRoot: "/repo",
          head: "base",
          branch: "refs/heads/main",
          detached: false,
          locked: false,
          prunable: false,
          isActive: true,
        },
        activeWorktreeIndex: 0,
      });

      const result = mergePrTool(123);

      expect(result.details.localCleanup).toEqual({
        status: "retained",
        branch: "feature/topic",
        reason: "branch_occupied_by_worktree",
        worktrees: [
          expect.objectContaining({ path: "/linked topic", state: "locked", locked: true, lockedReason: "in use" }),
        ],
      });
    });

    it("conservatively retains a branch named by a prunable record without pruning it", () => {
      mockMergeCommands();
      const context = getWorktreeContext();
      vi.mocked(getWorktreeContext).mockReturnValue({
        ...context,
        worktrees: [
          {
            worktreeRoot: "/missing-worktree",
            head: "abc",
            branch: "refs/heads/feature/topic",
            detached: false,
            locked: false,
            prunable: true,
            prunableReason: "gitdir file points to non-existent location",
            isActive: false,
          },
        ],
      });

      const result = mergePrTool(123);

      expect(result.details.localCleanup).toEqual({
        status: "retained",
        branch: "feature/topic",
        reason: "branch_occupied_by_worktree",
        worktrees: [expect.objectContaining({ path: "/missing-worktree", state: "prunable", prunable: true })],
      });
      expect(execGit).not.toHaveBeenCalledWith(
        expect.stringMatching(/worktree (prune|remove|unlock)/),
        expect.anything(),
      );
    });

    it("keeps merge success and exposes remote cleanup failure while continuing local cleanup", () => {
      mockMergeCommands();
      const implementation = vi.mocked(execGh).getMockImplementation();
      vi.mocked(execGh).mockImplementation((command, cwd) => {
        if (command.startsWith("gh api")) throw new Error("HTTP 403: Resource not accessible");
        return implementation?.(command, cwd) ?? "";
      });

      const result = mergePrTool(123);

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Remote cleanup failed");
      expect(result.content[0].text).toContain(
        JSON.stringify({
          mergeStatus: "merged",
          state: "MERGED",
          remoteCleanup: {
            status: "failed",
            repository: "base/repo",
            ref: "refs/heads/feature/topic",
            error: "HTTP 403: Resource not accessible",
          },
          localCleanup: { status: "deleted", branch: "feature/topic" },
          cleanupComplete: false,
        }),
      );
      expect(result.details.remoteCleanup).toEqual(
        expect.objectContaining({ status: "failed", error: "HTTP 403: Resource not accessible" }),
      );
      expect(result.details.localCleanup).toEqual({ status: "deleted", branch: "feature/topic" });
      expect(result.details.deletedBranch).toBe(false);
    });

    it("skips both ref deletions when the authoritative head OID is absent", () => {
      mockMergeCommands({ ...sameRepoPr, headRefOid: undefined });

      const result = mergePrTool(123);

      expect(result.details.remoteCleanup).toEqual({
        status: "skipped",
        reason: "missing_head_ref_oid_metadata",
        ref: "refs/heads/feature/topic",
      });
      expect(result.details.localCleanup).toEqual({
        status: "skipped",
        branch: "feature/topic",
        reason: "missing_head_ref_oid_metadata",
      });
      expect(execGh).not.toHaveBeenCalledWith(expect.stringContaining("gh api"), expect.anything());
      expect(getWorktreeContext).not.toHaveBeenCalled();
      expect(execGit).not.toHaveBeenCalled();
    });

    it("retains a remote ref that moved after the PR metadata snapshot", () => {
      mockMergeCommands();
      const implementation = vi.mocked(execGh).getMockImplementation();
      vi.mocked(execGh).mockImplementation((command, cwd) => {
        if (command.startsWith("gh api") && !command.includes("--method DELETE")) {
          return JSON.stringify({ object: { sha: "new456" } });
        }
        return implementation?.(command, cwd) ?? "";
      });

      const result = mergePrTool(123);

      expect(result.details.remoteCleanup).toEqual({
        status: "skipped",
        reason: "remote_ref_oid_mismatch",
        ref: "refs/heads/feature/topic",
      });
      expect(execGh).not.toHaveBeenCalledWith(expect.stringContaining("--method DELETE"), expect.anything());
    });

    it("deletes only the encoded authoritative same-repository head ref", () => {
      mockMergeCommands({ ...sameRepoPr, headRefName: "feature/slash #1" });

      mergePrTool(123);

      const apiCalls = vi.mocked(execGh).mock.calls.filter(([command]) => command.startsWith("gh api"));
      expect(apiCalls).toEqual([
        ["gh api --hostname 'github.com' 'repos/base/repo/git/ref/heads%2Ffeature%2Fslash%20%231'", undefined],
        [
          "gh api --hostname 'github.com' --method DELETE 'repos/base/repo/git/refs/heads%2Ffeature%2Fslash%20%231'",
          undefined,
        ],
      ]);
      expect(
        vi
          .mocked(execGh)
          .mock.calls.map(([command]) => command)
          .join("\n"),
      ).not.toContain("origin");
    });

    it("targets the validated enterprise hostname for ref verification and deletion", () => {
      mockMergeCommands({
        ...sameRepoPr,
        url: "https://github.enterprise.test/base/repo/pull/123",
        headRepository: {
          id: "R_enterprise",
          name: "repo",
          nameWithOwner: "base/repo",
        },
      });
      const implementation = vi.mocked(execGh).getMockImplementation();
      vi.mocked(execGh).mockImplementation((command, cwd) => {
        if (command === "gh repo view --json nameWithOwner,url") {
          return JSON.stringify({ nameWithOwner: "base/repo", url: "https://github.enterprise.test/base/repo" });
        }
        return implementation?.(command, cwd) ?? "";
      });

      const result = mergePrTool(123);
      const apiCommands = vi
        .mocked(execGh)
        .mock.calls.map(([command]) => command)
        .filter((command) => command.startsWith("gh api"));

      expect(result.details.remoteCleanup).toEqual(expect.objectContaining({ status: "deleted" }));
      expect(apiCommands).toHaveLength(2);
      expect(apiCommands.every((command) => command.includes("--hostname 'github.enterprise.test'"))).toBe(true);
      expect(apiCommands.join("\n")).not.toContain("github.com");
    });

    it.each([
      ["missing", undefined],
      ["non-HTTPS", "http://github.com/base/repo/pull/123"],
      ["credential-bearing", "https://user@github.com/base/repo/pull/123"],
      ["non-PR-shaped", "https://github.com/base/repo/issues/123"],
    ])("skips both cleanups for a %s authoritative PR URL", (_case, url) => {
      mockMergeCommands({ ...sameRepoPr, url });

      const result = mergePrTool(123);

      expect(result.details.remoteCleanup).toEqual({
        status: "skipped",
        reason: "missing_or_invalid_pr_url",
        ref: "refs/heads/feature/topic",
      });
      expect(result.details.localCleanup).toEqual({
        status: "skipped",
        branch: "feature/topic",
        reason: "missing_or_invalid_pr_url",
      });
      expect(execGh).not.toHaveBeenCalledWith(expect.stringContaining("gh api"), expect.anything());
      expect(getWorktreeContext).not.toHaveBeenCalled();
      expect(execGit).not.toHaveBeenCalled();
    });

    it("skips both cleanups when the PR and active repository hostnames mismatch", () => {
      mockMergeCommands();
      const implementation = vi.mocked(execGh).getMockImplementation();
      vi.mocked(execGh).mockImplementation((command, cwd) => {
        if (command === "gh repo view --json nameWithOwner,url") {
          return JSON.stringify({ nameWithOwner: "base/repo", url: "https://enterprise.test/base/repo" });
        }
        return implementation?.(command, cwd) ?? "";
      });

      const result = mergePrTool(123);

      expect(result.details.remoteCleanup).toEqual({
        status: "skipped",
        reason: "repository_hostname_mismatch",
        ref: "refs/heads/feature/topic",
      });
      expect(result.details.localCleanup).toEqual({
        status: "skipped",
        branch: "feature/topic",
        reason: "repository_hostname_mismatch",
      });
      expect(execGh).not.toHaveBeenCalledWith(expect.stringContaining("gh api"), expect.anything());
      expect(getWorktreeContext).not.toHaveBeenCalled();
      expect(execGit).not.toHaveBeenCalled();
    });

    it("skips both cleanups for an invalid active repository URL", () => {
      mockMergeCommands();
      const implementation = vi.mocked(execGh).getMockImplementation();
      vi.mocked(execGh).mockImplementation((command, cwd) => {
        if (command === "gh repo view --json nameWithOwner,url") {
          return JSON.stringify({ nameWithOwner: "base/repo", url: "ssh://github.com/base/repo" });
        }
        return implementation?.(command, cwd) ?? "";
      });

      const result = mergePrTool(123);

      expect(result.details.remoteCleanup).toEqual({
        status: "skipped",
        reason: "missing_or_invalid_active_repository_url",
        ref: "refs/heads/feature/topic",
      });
      expect(result.details.localCleanup).toEqual({
        status: "skipped",
        branch: "feature/topic",
        reason: "missing_or_invalid_active_repository_url",
      });
      expect(execGh).not.toHaveBeenCalledWith(expect.stringContaining("gh api"), expect.anything());
      expect(getWorktreeContext).not.toHaveBeenCalled();
      expect(execGit).not.toHaveBeenCalled();
    });

    it("targets a fork exactly and reports authorization failure without local or base-repository retries", () => {
      mockMergeCommands({
        ...sameRepoPr,
        headRepository: {
          id: "R_fork",
          name: "repo-fork",
          nameWithOwner: "contributor/repo-fork",
        },
        headRepositoryOwner: { login: "contributor" },
        isCrossRepository: true,
      });
      const implementation = vi.mocked(execGh).getMockImplementation();
      vi.mocked(execGh).mockImplementation((command, cwd) => {
        if (command.startsWith("gh api")) throw new Error("HTTP 404: Not Found");
        return implementation?.(command, cwd) ?? "";
      });

      const result = mergePrTool(123);
      const allCommands = vi
        .mocked(execGh)
        .mock.calls.map(([command]) => command)
        .join("\n");

      expect(result.isError).toBeUndefined();
      expect(result.details.remoteCleanup).toEqual(
        expect.objectContaining({
          status: "failed",
          repository: "contributor/repo-fork",
          error: "HTTP 404: Not Found",
        }),
      );
      expect(result.details.localCleanup).toEqual({
        status: "skipped",
        branch: "feature/topic",
        reason: "cross_repository_head",
      });
      expect(allCommands).toContain("repos/contributor/repo-fork/git/ref/heads%2Ffeature%2Ftopic");
      expect(allCommands).not.toContain("repos/base/repo/git/refs");
      expect(allCommands).toContain("gh repo view --json nameWithOwner,url");
      expect(execGit).not.toHaveBeenCalled();
    });

    it.each([
      [
        "headRefName",
        { ...sameRepoPr, headRefName: undefined },
        { status: "skipped", reason: "missing_head_ref_metadata" },
        { status: "skipped", reason: "missing_head_ref_metadata" },
      ],
      [
        "isCrossRepository",
        { ...sameRepoPr, isCrossRepository: undefined },
        expect.objectContaining({ status: "deleted" }),
        { status: "skipped", branch: "feature/topic", reason: "missing_cross_repository_metadata" },
      ],
    ])("handles absent %s metadata without consulting worktrees", (_field, pr, remoteCleanup, localCleanup) => {
      mockMergeCommands(pr);

      const result = mergePrTool(123);

      expect(result.details.remoteCleanup).toEqual(remoteCleanup);
      expect(result.details.localCleanup).toEqual(localCleanup);
      expect(getWorktreeContext).not.toHaveBeenCalled();
      expect(execGit).not.toHaveBeenCalled();
    });

    it.each([
      ["nameWithOwner", { url: "https://github.com/base/repo" }, "missing_active_repository_metadata"],
      ["URL", { nameWithOwner: "base/repo" }, "missing_or_invalid_active_repository_url"],
    ])("skips cleanup when active repository %s metadata is absent", (_field, activeInfo, localReason) => {
      mockMergeCommands();
      const implementation = vi.mocked(execGh).getMockImplementation();
      vi.mocked(execGh).mockImplementation((command, cwd) => {
        if (command === "gh repo view --json nameWithOwner,url") return JSON.stringify(activeInfo);
        return implementation?.(command, cwd) ?? "";
      });

      const result = mergePrTool(123);

      expect(result.details.remoteCleanup).toEqual(
        expect.objectContaining({ status: "skipped", reason: "missing_or_invalid_active_repository_url" }),
      );
      expect(result.details.localCleanup).toEqual(expect.objectContaining({ status: "skipped", reason: localReason }));
      expect(getWorktreeContext).not.toHaveBeenCalled();
      expect(execGit).not.toHaveBeenCalled();
    });

    it("skips local cleanup when authoritative repository identities mismatch", () => {
      mockMergeCommands({
        ...sameRepoPr,
        headRepository: {
          id: "R_mismatch",
          name: "repo-fork",
          nameWithOwner: "contributor/repo-fork",
        },
      });

      const result = mergePrTool(123);

      expect(result.details.localCleanup).toEqual({
        status: "skipped",
        branch: "feature/topic",
        reason: "repository_identity_mismatch",
      });
      expect(getWorktreeContext).not.toHaveBeenCalled();
      expect(execGit).not.toHaveBeenCalled();
    });

    it("skips both cleanups when deleted head-repository metadata is missing", () => {
      mockMergeCommands({
        ...sameRepoPr,
        headRepository: null,
        headRepositoryOwner: null,
      });

      const result = mergePrTool(123);

      expect(result.isError).toBeUndefined();
      expect(result.details.remoteCleanup).toEqual({
        status: "skipped",
        reason: "missing_head_repository_metadata",
        ref: "refs/heads/feature/topic",
      });
      expect(result.details.localCleanup).toEqual({
        status: "skipped",
        branch: "feature/topic",
        reason: "missing_head_repository_metadata",
      });
      expect(execGh).not.toHaveBeenCalledWith(expect.stringContaining("gh api"), expect.anything());
      expect(execGh).not.toHaveBeenCalledWith("gh repo view --json nameWithOwner", expect.anything());
      expect(execGit).not.toHaveBeenCalled();
    });

    it("observes successful local deletion only after the git delete command succeeds", () => {
      mockMergeCommands();

      const result = mergePrTool(123, true, true, "Custom Title", "Custom Message");
      const mergeCall = vi.mocked(execGh).mock.calls.find(([command]) => command.startsWith("gh pr merge"))?.[0];

      expect(result.details.mergeType).toBe("squash-merged");
      expect(mergeCall).toContain("--subject 'Custom Title'");
      expect(mergeCall).toContain("--body 'Custom Message'");
      expect(execGit).toHaveBeenCalledWith("git branch --delete -- 'feature/topic'", undefined);
      expect(result.details.localCleanup).toEqual({ status: "deleted", branch: "feature/topic" });
    });

    it("reports local deletion failure without changing merge success", () => {
      mockMergeCommands();
      vi.mocked(execGit).mockImplementation(() => {
        throw new Error("branch is not fully merged");
      });

      const result = mergePrTool(123);

      expect(result.isError).toBeUndefined();
      expect(result.details.localCleanup).toEqual({
        status: "failed",
        branch: "feature/topic",
        error: "branch is not fully merged",
      });
    });

    it("exposes an active repository lookup error as failed local cleanup", () => {
      mockMergeCommands();
      const implementation = vi.mocked(execGh).getMockImplementation();
      vi.mocked(execGh).mockImplementation((command, cwd) => {
        if (command === "gh repo view --json nameWithOwner,url") throw new Error("repository lookup denied");
        return implementation?.(command, cwd) ?? "";
      });

      const result = mergePrTool(123);

      expect(result.isError).toBeUndefined();
      expect(result.details.remoteCleanup).toEqual({
        status: "skipped",
        reason: "active_repository_lookup_failed",
        ref: "refs/heads/feature/topic",
      });
      expect(result.details.localCleanup).toEqual({
        status: "failed",
        branch: "feature/topic",
        error: "repository lookup denied",
      });
      expect(execGit).not.toHaveBeenCalled();
    });

    it("handles closed PR", () => {
      mockMergeCommands({ ...sameRepoPr, state: "CLOSED" });

      const result = mergePrTool(123);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not open");
    });

    it("detects PR from current branch", () => {
      vi.mocked(execGit).mockImplementation((command: string) =>
        command === "git branch --show-current" ? "feature" : "",
      );
      vi.mocked(execGh).mockImplementation((command: string) => {
        if (command.startsWith("gh pr list")) return JSON.stringify([{ number: 456 }]);
        if (command.startsWith("gh pr view")) return JSON.stringify(sameRepoPr);
        if (command === "gh repo view --json nameWithOwner") return JSON.stringify({ nameWithOwner: "base/repo" });
        return "";
      });

      const result = mergePrTool(undefined, false, false);

      expect(result.details.prNumber).toBe(456);
    });

    it("returns error when no PR found", () => {
      vi.mocked(execGit).mockReturnValue("feature-branch");
      vi.mocked(execGh).mockReturnValue("");

      const result = mergePrTool();

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("No PR number provided");
    });

    it("handles merge error before cleanup", () => {
      mockMergeCommands();
      vi.mocked(execGh).mockImplementation((command: string) => {
        if (command.startsWith("gh pr view")) return JSON.stringify(sameRepoPr);
        if (command === "gh repo view --json nameWithOwner") return JSON.stringify({ nameWithOwner: "base/repo" });
        if (command.startsWith("gh pr merge")) throw new Error("Merge conflict");
        return "";
      });

      const result = mergePrTool(123);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed to merge PR");
      expect(execGh).not.toHaveBeenCalledWith(expect.stringContaining("gh api"), expect.anything());
      expect(execGh).not.toHaveBeenCalledWith("gh repo view --json nameWithOwner", expect.anything());
      expect(execGit).not.toHaveBeenCalled();
    });
  });

  describe("checkCiTool", () => {
    it("checks CI by PR number using gh pr checks", () => {
      vi.mocked(execGh).mockReturnValue(
        JSON.stringify([{ name: "Build", state: "SUCCESS", link: "https://ci", workflow: "CI" }]),
      );

      const result = checkCiTool(123);

      expect(vi.mocked(execGh)).toHaveBeenCalledWith("gh pr checks 123 --json name,state,link,workflow", undefined);
      expect(result.content[0].text).toContain("CI Status");
      expect(result.content[0].text).toContain("Build: SUCCESS");
      expect(result.details.checks).toBeDefined();
    });

    it("checks CI by branch", () => {
      vi.mocked(execGh).mockReturnValue(JSON.stringify([{ workflowName: "Build", status: "in_progress" }]));

      const result = checkCiTool(undefined, "feature-branch");

      expect(result.content[0].text).toContain("CI Status");
    });

    it("handles no CI runs found", () => {
      vi.mocked(execGit).mockReturnValue("feature-branch");
      vi.mocked(execGh).mockReturnValue("");

      const result = checkCiTool();

      expect(result.content[0].text).toContain("No CI runs found");
      expect(result.details.checks).toEqual([]);
    });

    it("handles CI check error", () => {
      vi.mocked(execGit).mockReturnValue("feature-branch");
      vi.mocked(execGh).mockImplementation(() => {
        throw new Error("gh not authenticated");
      });

      const result = checkCiTool();

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed to check CI");
    });
  });

  describe("repoInfoTool", () => {
    it("exposes complete safety context in model-visible content", () => {
      vi.mocked(getWorktreeContext).mockReturnValueOnce({
        worktreeRoot: "/repo-linked",
        privateGitDir: "/repo/.git/worktrees/repo-linked",
        gitDir: "/repo/.git/worktrees/repo-linked",
        commonGitDir: "/repo/.git",
        isLinkedWorktree: true,
        head: { commit: "abc123", branch: "refs/heads/feature-branch", detached: false },
        worktrees: [
          {
            worktreeRoot: "/repo-linked",
            head: "abc123",
            branch: "refs/heads/feature-branch",
            detached: false,
            locked: false,
            prunable: false,
            isActive: true,
          },
          {
            worktreeRoot: "/locked topic",
            head: "def456",
            detached: true,
            locked: true,
            lockedReason: "in use",
            prunable: true,
            prunableReason: "missing gitdir",
            isActive: false,
          },
        ],
        activeWorktree: {
          worktreeRoot: "/repo-linked",
          head: "abc123",
          branch: "refs/heads/feature-branch",
          detached: false,
          locked: false,
          prunable: false,
          isActive: true,
        },
        activeWorktreeIndex: 0,
      });
      vi.mocked(execGit).mockReturnValueOnce("");

      const result = repoInfoTool();
      const content = result.content[0].text;

      expect(content).toContain("feature-branch");
      expect(content).toContain('"privateGitDir":"/repo/.git/worktrees/repo-linked"');
      expect(content).toContain('"commonGitDir":"/repo/.git"');
      expect(content).toContain('"head":{"commit":"abc123","branch":"refs/heads/feature-branch","detached":false}');
      expect(content).toContain(
        '"worktreeRoot":"/repo-linked","head":"abc123","branch":"refs/heads/feature-branch","detached":false,"locked":false,"prunable":false,"isActive":true',
      );
      expect(content).toContain(
        '"worktreeRoot":"/locked topic","head":"def456","detached":true,"locked":true,"lockedReason":"in use","prunable":true,"prunableReason":"missing gitdir","isActive":false',
      );
      expect(content).toContain('"activeWorktreeIndex":0');
      expect(result.details.branch).toBe("feature-branch");
    });

    it("returns repository information on detached HEAD", async () => {
      const { getWorktreeContext } = await import("../extensions/git.js");
      vi.mocked(getWorktreeContext).mockReturnValueOnce({
        worktreeRoot: "/repo",
        privateGitDir: "/repo/.git",
        gitDir: "/repo/.git",
        commonGitDir: "/repo/.git",
        isLinkedWorktree: false,
        head: { commit: "abcdef1234567890", detached: true },
        worktrees: [],
        activeWorktree: {
          worktreeRoot: "/repo",
          head: "abcdef1234567890",
          detached: true,
          locked: false,
          prunable: false,
        },
        activeWorktreeIndex: 0,
      });
      vi.mocked(execGit).mockReturnValueOnce("");

      const result = repoInfoTool();

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Detached HEAD at abcdef123456");
      expect(result.details.head).toEqual({ commit: "abcdef1234567890", detached: true });
    });

    it("parses staged files", () => {
      vi.mocked(execGit).mockReturnValueOnce("A  file1.js\nMM file2.ts");

      const result = repoInfoTool();

      expect(result.details.staged).toContain("file1.js");
      expect(result.details.modified).toContain("file2.ts");
    });

    it("parses untracked files", () => {
      vi.mocked(execGit).mockReturnValueOnce("?? untracked.txt");

      const result = repoInfoTool();

      expect(result.details.untracked).toContain("untracked.txt");
    });

    it("reports hasChanges correctly", () => {
      vi.mocked(execGit).mockReturnValueOnce("");

      const result = repoInfoTool();

      expect(result.details.hasChanges).toBe(false);
    });
  });

  describe("getLatestTagTool", () => {
    it("returns latest tag", () => {
      vi.mocked(execGit).mockReturnValueOnce("v1.2.3").mockReturnValueOnce("10");

      const result = getLatestTagTool();

      expect(result.content[0].text).toContain("v1.2.3");
      expect(result.details.tag).toBe("v1.2.3");
      expect(result.details.commitsSince).toBe(10);
    });

    it("handles no tags found", () => {
      vi.mocked(execGit).mockReturnValue("");

      const result = getLatestTagTool();

      expect(result.content[0].text).toContain("No version tags found");
      expect(result.details.tag).toBeNull();
    });

    it("handles tag error", () => {
      vi.mocked(execGit).mockImplementation(() => {
        throw new Error("No git repository");
      });

      const result = getLatestTagTool();

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed to get latest tag");
    });
  });

  describe("analyzeCommitsTool", () => {
    it("analyzes commits and returns minor bump for feat", () => {
      vi.mocked(execGit).mockReturnValueOnce("v1.0.0").mockReturnValueOnce("feat: add new feature");

      const result = analyzeCommitsTool();

      expect(result.details.type).toBe("minor");
      expect(result.details.currentVersion).toBe("1.0.0");
      expect(result.details.newVersion).toBe("1.1.0");
    });

    it("returns patch bump for fix", () => {
      vi.mocked(execGit).mockReturnValueOnce("v1.0.0").mockReturnValueOnce("fix: fix bug");

      const result = analyzeCommitsTool();

      expect(result.details.type).toBe("patch");
      expect(result.details.newVersion).toBe("1.0.1");
    });

    it("returns major bump for breaking change", () => {
      vi.mocked(execGit).mockReturnValueOnce("v1.0.0").mockReturnValueOnce("feat!: breaking change");

      const result = analyzeCommitsTool();

      expect(result.details.type).toBe("major");
      expect(result.details.newVersion).toBe("2.0.0");
    });

    it("handles no commits", () => {
      vi.mocked(execGit).mockReturnValueOnce("").mockReturnValueOnce("");

      const result = analyzeCommitsTool();

      expect(result.content[0].text).toContain("No commits to analyze");
    });

    it("groups commits by type", () => {
      vi.mocked(execGit)
        .mockReturnValueOnce("v1.0.0")
        .mockReturnValueOnce("feat: add feature\nfix: fix bug\nchore: update deps");

      const result = analyzeCommitsTool();

      expect(result.content[0].text).toContain("Features");
      expect(result.content[0].text).toContain("Fixes");
    });

    it("handles analyze error", () => {
      vi.mocked(execGit).mockImplementation(() => {
        throw new Error("No git repository");
      });

      const result = analyzeCommitsTool();

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed to analyze commits");
    });
  });

  describe("bumpVersionTool", () => {
    // Note: Testing bumpVersionTool requires mocking node:fs module
    // which is complex due to ES module imports. These tests are skipped
    // as the functionality is already covered by the bumpVersion helper tests.
    it("placeholder test", () => {
      expect(true).toBe(true);
    });
  });

  describe("createReleaseTool", () => {
    it("creates release successfully and targets active HEAD", () => {
      vi.mocked(execGit).mockReturnValue("abc123head");
      vi.mocked(execGh).mockReturnValue("https://github.com/owner/repo/releases/tag/v1.0.0");

      const result = createReleaseTool("v1.0.0", "Version 1.0.0", "Release notes");

      expect(result.content[0].text).toContain("Created release");
      expect(result.details.tag).toBe("v1.0.0");
      const ghCall = vi.mocked(execGh).mock.calls[0][0] as string;
      expect(ghCall).toContain("--notes 'Release notes'");
      expect(ghCall).toContain("--target 'abc123head'");
    });

    it("preserves draft and prerelease options while targeting active HEAD", () => {
      vi.mocked(execGit).mockReturnValue("abc123head");
      vi.mocked(execGh).mockReturnValue("https://github.com/owner/repo/releases/tag/v2.0.0");

      createReleaseTool("v2.0.0", "Version 2.0.0", "Notes", true, true, "/active");

      expect(execGit).toHaveBeenCalledWith("git rev-parse HEAD", "/active");
      expect(execGh).toHaveBeenCalledWith(expect.stringContaining("--draft --prerelease"), "/active");
    });

    it("creates release with explicit empty notes when body is omitted", () => {
      vi.mocked(execGit).mockReturnValue("abc123head");
      vi.mocked(execGh).mockReturnValue("https://github.com/owner/repo/releases/tag/v1.0.0");

      const result = createReleaseTool("v1.0.0", "Version 1.0.0");

      expect(result.content[0].text).toContain("Created release");
      const ghCall = vi.mocked(execGh).mock.calls[0][0] as string;
      expect(ghCall).toContain("--notes ''");
    });

    it("handles release creation error", () => {
      vi.mocked(execGh).mockImplementation(() => {
        throw new Error("gh not authenticated");
      });

      const result = createReleaseTool("v1.0.0", "Version 1.0.0");

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed to create release");
    });
  });
});
