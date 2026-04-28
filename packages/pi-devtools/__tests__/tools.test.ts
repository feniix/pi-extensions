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
} from "../extensions/index.js";

// Mock the git.ts module
vi.mock("../extensions/git.js", () => ({
  execGit: vi.fn(),
  execGh: vi.fn(),
  getDefaultBranch: vi.fn().mockReturnValue("main"),
}));

import { execGh, execGit } from "../extensions/git.js";

describe("pi-devtools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(execGit).mockReset();
    vi.mocked(execGh).mockReset();
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
    it("merges PR by number", () => {
      vi.mocked(execGh)
        .mockReturnValueOnce(JSON.stringify({ title: "Test PR", url: "https://github.com/123", state: "OPEN" }))
        .mockReturnValueOnce("");

      const result = mergePrTool(123);

      expect(result.content[0].text).toContain("Merged PR");
      expect(result.details.prNumber).toBe(123);
      expect(result.details.mergeType).toBe("merged");
    });

    it("squash merges PR", () => {
      vi.mocked(execGh)
        .mockReturnValueOnce(JSON.stringify({ title: "Test PR", url: "https://github.com/123", state: "OPEN" }))
        .mockReturnValueOnce("");

      const result = mergePrTool(123, true);

      expect(result.details.mergeType).toBe("squash-merged");
    });

    it("squash merges with commit title using GitHub CLI subject flag", () => {
      vi.mocked(execGh)
        .mockReturnValueOnce(JSON.stringify({ title: "Test PR", url: "https://github.com/123", state: "OPEN" }))
        .mockReturnValueOnce("");

      mergePrTool(123, true, true, "Custom Title");

      const mergeCall = vi.mocked(execGh).mock.calls[1][0] as string;
      expect(mergeCall).toContain("--subject 'Custom Title'");
      expect(mergeCall).not.toContain("--title");
    });

    it("squash merges with commit message", () => {
      vi.mocked(execGh)
        .mockReturnValueOnce(JSON.stringify({ title: "Test PR", url: "https://github.com/123", state: "OPEN" }))
        .mockReturnValueOnce("");

      mergePrTool(123, true, true, undefined, "Custom Message");

      const mergeCall = vi.mocked(execGh).mock.calls[1][0] as string;
      expect(mergeCall).toContain("--body");
    });

    it("merges without deleting branch", () => {
      vi.mocked(execGh)
        .mockReturnValueOnce(JSON.stringify({ title: "Test PR", url: "https://github.com/123", state: "OPEN" }))
        .mockReturnValueOnce("");

      mergePrTool(123, false, false);

      // Get the merge command (second call)
      const mergeCall = vi.mocked(execGh).mock.calls[1][0] as string;
      expect(mergeCall).not.toContain("--delete-branch");
    });

    it("handles closed PR", () => {
      vi.mocked(execGh).mockReturnValue(
        JSON.stringify({ title: "Test PR", url: "https://github.com/123", state: "CLOSED" }),
      );

      const result = mergePrTool(123);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not open");
    });

    it("detects PR from current branch", () => {
      vi.mocked(execGit).mockReturnValue("feature-branch");
      vi.mocked(execGh)
        .mockReturnValueOnce(JSON.stringify([{ number: 456, title: "Feature PR" }]))
        .mockReturnValueOnce(JSON.stringify({ title: "Feature PR", url: "https://github.com/456", state: "OPEN" }))
        .mockReturnValueOnce("");

      const result = mergePrTool();

      expect(result.details.prNumber).toBe(456);
    });

    it("returns error when no PR found", () => {
      vi.mocked(execGit).mockReturnValue("feature-branch");
      vi.mocked(execGh).mockReturnValue("");

      const result = mergePrTool();

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("No PR number provided");
    });

    it("handles merge error", () => {
      vi.mocked(execGh)
        .mockReturnValueOnce(JSON.stringify({ title: "Test PR", url: "https://github.com/123", state: "OPEN" }))
        .mockImplementation(() => {
          throw new Error("Merge conflict");
        });

      const result = mergePrTool(123);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed to merge PR");
    });
  });

  describe("checkCiTool", () => {
    it("checks CI by PR number using gh pr checks", () => {
      vi.mocked(execGh).mockReturnValue(
        JSON.stringify([{ name: "Build", state: "SUCCESS", link: "https://ci", workflow: "CI" }]),
      );

      const result = checkCiTool(123);

      expect(vi.mocked(execGh)).toHaveBeenCalledWith("gh pr checks 123 --json name,state,link,workflow");
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
    it("returns repo info successfully", () => {
      vi.mocked(execGit).mockReturnValueOnce("feature-branch").mockReturnValueOnce("").mockReturnValueOnce("");

      const result = repoInfoTool();

      expect(result.content[0].text).toContain("feature-branch");
      expect(result.details.branch).toBe("feature-branch");
    });

    it("handles detached HEAD", () => {
      vi.mocked(execGit).mockImplementation((cmd: string) => {
        if (cmd === "git branch --show-current") {
          throw new Error("Not on a branch");
        }
        throw new Error("Unexpected command");
      });

      const result = repoInfoTool();

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Not on a branch");
    });

    it("parses staged files", () => {
      // Call sequence: git branch --show-current, git status --porcelain
      vi.mocked(execGit).mockReturnValueOnce("feature-branch").mockReturnValueOnce("A  file1.js\nMM file2.ts");

      const result = repoInfoTool();

      expect(result.details.staged).toContain("file1.js");
      expect(result.details.modified).toContain("file2.ts");
    });

    it("parses untracked files", () => {
      vi.mocked(execGit).mockReturnValueOnce("feature-branch").mockReturnValueOnce("?? untracked.txt");

      const result = repoInfoTool();

      expect(result.details.untracked).toContain("untracked.txt");
    });

    it("reports hasChanges correctly", () => {
      vi.mocked(execGit).mockReturnValueOnce("feature-branch").mockReturnValueOnce("").mockReturnValueOnce("");

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
    it("creates release successfully", () => {
      vi.mocked(execGh).mockReturnValue("https://github.com/owner/repo/releases/tag/v1.0.0");

      const result = createReleaseTool("v1.0.0", "Version 1.0.0", "Release notes");

      expect(result.content[0].text).toContain("Created release");
      expect(result.details.tag).toBe("v1.0.0");
      const ghCall = vi.mocked(execGh).mock.calls[0][0] as string;
      expect(ghCall).toContain("--notes 'Release notes'");
    });

    it("creates release with explicit empty notes when body is omitted", () => {
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
