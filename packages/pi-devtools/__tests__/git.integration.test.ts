import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execGh, execGit, getDefaultBranch, getGitContext, getWorktreeContext, isGitRepo } from "../extensions/git.js";
import { bumpVersionTool, commitTool, getLatestTagTool, mergePrTool, repoInfoTool } from "../extensions/index.js";

function withFakeMergeGh<T>(headRefName: string, run: () => T): T {
  const originalPath = process.env.PATH;
  const fakeBinDir = mkdtempSync(join(tmpdir(), "pi-devtools-merge-gh-"));
  const ghPath = join(fakeBinDir, "gh");
  const markerPath = join(fakeBinDir, "merged");
  writeFileSync(
    ghPath,
    `#!/bin/sh
marker=${JSON.stringify(markerPath)}
oid=$(git rev-parse ${JSON.stringify(`refs/heads/${headRefName}`)})
if [ "$1 $2" = "pr view" ]; then
  if [ -f "$marker" ]; then state=MERGED; mergedAt='"2026-07-11T12:00:00Z"'; rm -f "$marker"; else state=OPEN; mergedAt=null; fi
  printf '{"title":"Integration PR","url":"https://example.test/base/repo/pull/1","state":"%s","mergedAt":%s,"headRefName":"${headRefName}","headRefOid":"%s","headRepository":{"id":"R_integration","name":"repo","nameWithOwner":"base/repo"},"headRepositoryOwner":{"login":"base"},"isCrossRepository":false}\\n' "$state" "$mergedAt" "$oid"
  exit 0
fi
if [ "$1 $2" = "repo view" ]; then printf '%s\\n' '{"nameWithOwner":"base/repo","url":"https://example.test/base/repo"}'; exit 0; fi
if [ "$1 $2" = "pr merge" ]; then touch "$marker"; exit 0; fi
if [ "$1" = "api" ]; then printf '{"object":{"sha":"%s"}}\\n' "$oid"; exit 0; fi
exit 2
`,
    { encoding: "utf-8", mode: 0o755 },
  );
  process.env.PATH = `${fakeBinDir}:${originalPath ?? ""}`;

  try {
    return run();
  } finally {
    process.env.PATH = originalPath;
    rmSync(fakeBinDir, { recursive: true, force: true });
  }
}

describe("pi-devtools git integration", () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test using mktemp
    tempDir = execSync("mktemp -d", { encoding: "utf-8" }).trim();

    // Initialize git repo
    execSync("git init -b main", { cwd: tempDir, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: tempDir, stdio: "pipe" });
    execSync("git config user.name 'Test User'", { cwd: tempDir, stdio: "pipe" });

    // Create initial commit
    writeFileSync(join(tempDir, "initial.txt"), "initial");
    execSync("git add .", { cwd: tempDir, stdio: "pipe" });
    execSync("git commit -m 'initial commit'", { cwd: tempDir, stdio: "pipe" });
  });

  afterEach(() => {
    // Clean up temp directory
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("execGit", () => {
    it("executes git command successfully in temp repo", () => {
      const result = execGit(`git -C ${tempDir} status`);
      expect(result).toBeDefined();
    });

    it("throws error for invalid command", () => {
      expect(() => execGit("git invalid-command")).toThrow("Git error");
    });

    it("throws error when not in a git repo", () => {
      // Create a non-git directory using mktemp
      const nonGitDir = execSync("mktemp -d", { encoding: "utf-8" }).trim();
      try {
        expect(() => execGit(`git -C ${nonGitDir} status`)).toThrow();
      } finally {
        rmSync(nonGitDir, { recursive: true, force: true });
      }
    });

    it("handles error in command execution", () => {
      expect(() => execGit(`git -C ${tempDir} log --invalid-flag`)).toThrow();
    });
  });

  describe("session git context", () => {
    it("builds context for an explicit repository cwd without changing process cwd", () => {
      expect(getGitContext(tempDir)).toContain("Branch: main");
    });

    it("does not fall back to the process cwd for a non-repository cwd", () => {
      const nonGitDir = mkdtempSync(join(tmpdir(), "pi-devtools-non-git-"));
      try {
        expect(isGitRepo(nonGitDir)).toBe(false);
        expect(getGitContext(nonGitDir)).toBe("");
        expect(() => getWorktreeContext(nonGitDir)).toThrow("Git error");
      } finally {
        rmSync(nonGitDir, { recursive: true, force: true });
      }
    });
  });

  describe("worktree context", () => {
    it("scopes workflow, tag analysis, and version-file mutations to a linked worktree cwd", () => {
      const linkedDir = join(tmpdir(), `pi-devtools-active-${Date.now()}`);
      try {
        execSync(`git worktree add -b feature/active ${JSON.stringify(linkedDir)}`, { cwd: tempDir, stdio: "pipe" });
        execSync("git -c tag.gpgSign=false tag v1.0.0", { cwd: tempDir, stdio: "pipe" });
        writeFileSync(join(tempDir, "version.json"), '{"version":"1.0.0"}\n');
        writeFileSync(join(linkedDir, "version.json"), '{"version":"2.0.0"}\n');
        writeFileSync(join(linkedDir, "linked-only.txt"), "linked worktree");

        const commit = commitTool("test: linked cwd", ["linked-only.txt"], true, linkedDir);
        const version = bumpVersionTool("2.1.0", "version.json", linkedDir);
        const info = repoInfoTool(linkedDir);
        const tag = getLatestTagTool(linkedDir);

        expect(commit.isError).toBeUndefined();
        expect(version.isError).toBeUndefined();
        expect(info.details).toEqual(
          expect.objectContaining({
            branch: "feature/active",
            worktreeRoot: realpathSync(linkedDir),
            isLinkedWorktree: true,
          }),
        );
        expect(tag.details).toEqual(expect.objectContaining({ tag: "v1.0.0", commitsSince: 1 }));
        expect(JSON.parse(readFileSync(join(linkedDir, "version.json"), "utf-8")).version).toBe("2.1.0");
        expect(JSON.parse(readFileSync(join(tempDir, "version.json"), "utf-8")).version).toBe("1.0.0");
        expect(execGit("git log -1 --format=%s", linkedDir)).toBe("test: linked cwd");
        expect(execGit("git log -1 --format=%s", tempDir)).toBe("initial commit");
      } finally {
        try {
          execSync(`git worktree remove --force ${JSON.stringify(linkedDir)}`, { cwd: tempDir, stdio: "pipe" });
        } catch {
          rmSync(linkedDir, { recursive: true, force: true });
        }
      }
    });

    it("discovers canonical primary and linked topology, including a detached linked HEAD and spaces", () => {
      const linkedDir = join(tmpdir(), `pi devtools linked ${Date.now()}`);
      try {
        execSync(`git worktree add -b feature/worktree ${JSON.stringify(linkedDir)}`, { cwd: tempDir, stdio: "pipe" });

        const linkedRoot = execGit("git rev-parse --path-format=absolute --show-toplevel", linkedDir);
        const primary = getWorktreeContext(tempDir);
        expect(primary.worktreeRoot).toBe(execGit("git rev-parse --path-format=absolute --show-toplevel", tempDir));
        expect(primary.privateGitDir).toBe(primary.commonGitDir);
        expect(primary.gitDir).toBe(primary.privateGitDir);
        expect(primary.isLinkedWorktree).toBe(false);
        expect(primary.head).toEqual(expect.objectContaining({ branch: "refs/heads/main", detached: false }));
        expect(primary.worktrees.some((record) => record.worktreeRoot === linkedRoot)).toBe(true);

        execSync("git checkout --detach", { cwd: linkedDir, stdio: "pipe" });
        execSync("git worktree lock --reason 'integration lock reason' .", { cwd: linkedDir, stdio: "pipe" });
        const linked = getWorktreeContext(linkedDir);
        expect(linked.worktreeRoot).toBe(linkedRoot);
        expect(linked.privateGitDir).not.toBe(linked.commonGitDir);
        expect(linked.privateGitDir).toContain("/worktrees/");
        expect(linked.isLinkedWorktree).toBe(true);
        expect(linked.head).toEqual(expect.objectContaining({ detached: true }));
        expect(linked.head.branch).toBeUndefined();
        expect(linked.activeWorktree).toEqual(
          expect.objectContaining({
            worktreeRoot: linkedRoot,
            detached: true,
            locked: true,
            lockedReason: "integration lock reason",
            isActive: true,
          }),
        );
      } finally {
        try {
          execSync("git worktree unlock .", { cwd: linkedDir, stdio: "pipe" });
        } catch {
          // The fixture may not have reached the lock step.
        }
        try {
          execSync(`git worktree remove --force ${JSON.stringify(linkedDir)}`, { cwd: tempDir, stdio: "pipe" });
        } catch {
          rmSync(linkedDir, { recursive: true, force: true });
        }
      }
    });
  });

  describe("getDefaultBranch", () => {
    it("returns main in repo without origin", () => {
      // In a fresh repo without origin, should return main via fallback
      const result = getDefaultBranch(tempDir);
      expect(result).toBe("main");
    });
  });

  describe("createBranchTool integration", () => {
    it("creates a branch", () => {
      execGit(`git -C ${tempDir} checkout -b feature/test`);

      const branches = execGit(`git -C ${tempDir} branch`);
      expect(branches).toContain("feature/test");
    });

    it("fails when branch already exists", () => {
      execGit(`git -C ${tempDir} checkout -b feature/test`);
      expect(() => execGit(`git -C ${tempDir} checkout -b feature/test`)).toThrow();
    });
  });

  describe("commitTool integration", () => {
    it("stages files successfully", () => {
      writeFileSync(join(tempDir, "test.txt"), "test content");
      execSync(`git -C ${tempDir} add .`, { stdio: "pipe" });

      const staged = execGit(`git -C ${tempDir} diff --cached --name-only`);
      expect(staged).toContain("test.txt");
    });

    it("commits successfully", () => {
      writeFileSync(join(tempDir, "test.txt"), "test content");
      execSync(`git -C ${tempDir} add .`, { stdio: "pipe" });
      execGit(`git -C ${tempDir} commit -m "feat: add test"`);

      const log = execGit(`git -C ${tempDir} log --oneline -n 1`);
      expect(log).toContain("feat: add test");
    });
  });

  describe("pushTool integration", () => {
    it("pushes to remote", () => {
      // Setup origin using mktemp
      const originDir = execSync("mktemp -d", { encoding: "utf-8" }).trim();
      execSync("git init --bare", { cwd: originDir, stdio: "pipe" });
      execSync(`git remote add origin ${originDir}`, { cwd: tempDir, stdio: "pipe" });

      execGit(`git -C ${tempDir} push -u origin main`);

      rmSync(originDir, { recursive: true, force: true });
    });
  });

  describe("repoInfoTool integration", () => {
    it("gets current branch", () => {
      const branch = execGit(`git -C ${tempDir} branch --show-current`);
      expect(branch).toBe("main");
    });

    it("gets status output with changes", () => {
      writeFileSync(join(tempDir, "newfile.txt"), "content");

      const status = execGit(`git -C ${tempDir} status --porcelain`);
      expect(status).toContain("newfile.txt");
    });

    it("parses staged and modified files", () => {
      writeFileSync(join(tempDir, "initial.txt"), "modified content");
      execSync(`git -C ${tempDir} add initial.txt`, { stdio: "pipe" });

      writeFileSync(join(tempDir, "another.txt"), "new");
      execSync(`git -C ${tempDir} add .`, { stdio: "pipe" });

      const status = execGit(`git -C ${tempDir} status --porcelain`);
      expect(status).toContain("initial.txt");
      expect(status).toContain("another.txt");
    });
  });

  describe("getLatestTagTool integration", () => {
    it("returns empty when no tags", () => {
      const tags = execGit(`git -C ${tempDir} tag -l 'v*' | sort -rV | head -1`);
      expect(tags).toBe("");
    });

    it("returns latest tag", () => {
      execSync(`git -C ${tempDir} -c tag.gpgSign=false tag v1.0.0`);

      const tags = execGit(`git -C ${tempDir} tag -l 'v*' | sort -rV | head -1`);
      expect(tags).toBe("v1.0.0");
    });

    it("returns correct tag when multiple exist", () => {
      execSync(`git -C ${tempDir} -c tag.gpgSign=false tag v1.0.0`);
      execSync(`git -C ${tempDir} -c tag.gpgSign=false tag v2.0.0`);
      execSync(`git -C ${tempDir} -c tag.gpgSign=false tag v1.5.0`);

      const tags = execGit(`git -C ${tempDir} tag -l 'v*' | sort -rV | head -1`);
      expect(tags).toBe("v2.0.0");
    });
  });

  describe("analyzeCommitsTool integration", () => {
    it("parses conventional commits", () => {
      writeFileSync(join(tempDir, "feat.txt"), "feat");
      execSync("git add .", { cwd: tempDir, stdio: "pipe" });
      execSync(`git -C ${tempDir} commit -m "feat: add feature"`, { stdio: "pipe" });

      const commits = execGit(`git -C ${tempDir} log --format="%s" -n 1`);
      expect(commits).toContain("feat:");
    });

    it("counts commits since tag", () => {
      execSync(`git -C ${tempDir} -c tag.gpgSign=false tag v1.0.0`);

      writeFileSync(join(tempDir, "a.txt"), "a");
      execSync("git add .", { cwd: tempDir, stdio: "pipe" });
      execSync(`git -C ${tempDir} commit -m "fix: fix"`, { stdio: "pipe" });

      const count = execGit(`git -C ${tempDir} log v1.0.0..HEAD --oneline | wc -l`).trim();
      expect(parseInt(count, 10)).toBeGreaterThan(0);
    });
  });

  describe("mergePrTool worktree-safe cleanup integration", () => {
    it("retains a branch occupied by the active linked worktree", () => {
      const linkedDir = join(tmpdir(), `pi-devtools-merge-active-${Date.now()}`);
      try {
        execSync(`git worktree add -b feature/active-cleanup ${JSON.stringify(linkedDir)}`, {
          cwd: tempDir,
          stdio: "pipe",
        });

        const result = withFakeMergeGh("feature/active-cleanup", () =>
          mergePrTool(1, false, true, undefined, undefined, linkedDir),
        );

        expect(result.isError).toBeUndefined();
        expect(result.details.localCleanup).toEqual({
          status: "retained",
          branch: "feature/active-cleanup",
          reason: "branch_occupied_by_worktree",
          worktrees: [expect.objectContaining({ path: realpathSync(linkedDir), state: "current", isActive: true })],
        });
        expect(execGit("git show-ref --verify refs/heads/feature/active-cleanup", tempDir)).not.toBe("");
      } finally {
        try {
          execSync(`git worktree remove --force ${JSON.stringify(linkedDir)}`, { cwd: tempDir, stdio: "pipe" });
        } catch {
          rmSync(linkedDir, { recursive: true, force: true });
        }
      }
    });

    it("retains a branch occupied by another real locked linked worktree", () => {
      const linkedDir = join(tmpdir(), `pi-devtools-merge-locked-${Date.now()}`);
      try {
        execSync(`git worktree add -b feature/locked-cleanup ${JSON.stringify(linkedDir)}`, {
          cwd: tempDir,
          stdio: "pipe",
        });
        execSync("git worktree lock --reason 'integration occupancy' .", { cwd: linkedDir, stdio: "pipe" });

        const result = withFakeMergeGh("feature/locked-cleanup", () =>
          mergePrTool(1, false, true, undefined, undefined, tempDir),
        );

        expect(result.isError).toBeUndefined();
        expect(result.details.localCleanup).toEqual({
          status: "retained",
          branch: "feature/locked-cleanup",
          reason: "branch_occupied_by_worktree",
          worktrees: [
            expect.objectContaining({
              path: realpathSync(linkedDir),
              state: "locked",
              locked: true,
              lockedReason: "integration occupancy",
            }),
          ],
        });
        expect(execGit("git show-ref --verify refs/heads/feature/locked-cleanup", tempDir)).not.toBe("");
      } finally {
        try {
          execSync("git worktree unlock .", { cwd: linkedDir, stdio: "pipe" });
        } catch {
          // The fixture may not have reached the lock step.
        }
        try {
          execSync(`git worktree remove --force ${JSON.stringify(linkedDir)}`, { cwd: tempDir, stdio: "pipe" });
        } catch {
          rmSync(linkedDir, { recursive: true, force: true });
        }
      }
    });

    it("conservatively retains a branch claimed by a real prunable worktree record", () => {
      const linkedDir = join(tmpdir(), `pi-devtools-merge-prunable-${Date.now()}`);
      try {
        execSync(`git worktree add -b feature/prunable-cleanup ${JSON.stringify(linkedDir)}`, {
          cwd: tempDir,
          stdio: "pipe",
        });
        const canonicalLinkedDir = realpathSync(linkedDir);
        rmSync(linkedDir, { recursive: true, force: true });
        expect(getWorktreeContext(tempDir).worktrees).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ branch: "refs/heads/feature/prunable-cleanup", prunable: true }),
          ]),
        );

        const result = withFakeMergeGh("feature/prunable-cleanup", () =>
          mergePrTool(1, false, true, undefined, undefined, tempDir),
        );

        expect(result.isError).toBeUndefined();
        expect(result.details.localCleanup).toEqual({
          status: "retained",
          branch: "feature/prunable-cleanup",
          reason: "branch_occupied_by_worktree",
          worktrees: [expect.objectContaining({ path: canonicalLinkedDir, state: "prunable", prunable: true })],
        });
        expect(execGit("git show-ref --verify refs/heads/feature/prunable-cleanup", tempDir)).not.toBe("");
      } finally {
        rmSync(linkedDir, { recursive: true, force: true });
        execSync("git worktree prune", { cwd: tempDir, stdio: "pipe" });
      }
    });
  });

  describe("checkCiTool integration", () => {
    it("handles gh run list command without contacting GitHub", () => {
      const originalPath = process.env.PATH;
      const fakeBinDir = mkdtempSync(join(tmpdir(), "pi-devtools-run-gh-"));
      const ghPath = join(fakeBinDir, "gh");
      writeFileSync(ghPath, "#!/bin/sh\nprintf '%s\\n' '[]'\n", { encoding: "utf-8", mode: 0o755 });
      process.env.PATH = `${fakeBinDir}:${originalPath ?? ""}`;

      try {
        expect(execGh("gh run list --limit 1")).toBe("[]");
      } finally {
        process.env.PATH = originalPath;
        rmSync(fakeBinDir, { recursive: true, force: true });
      }
    });
  });
});

describe("execGh", () => {
  it("executes gh command successfully when a fake authenticated gh is on PATH", () => {
    const originalPath = process.env.PATH;
    const fakeBinDir = mkdtempSync(join(tmpdir(), "pi-devtools-gh-bin-"));
    const ghPath = join(fakeBinDir, "gh");
    writeFileSync(ghPath, '#!/bin/sh\nif [ "$1 $2" = "auth status" ]; then echo \'logged in\'; exit 0; fi\nexit 1\n', {
      encoding: "utf-8",
      mode: 0o755,
    });
    process.env.PATH = `${fakeBinDir}:${originalPath ?? ""}`;

    try {
      const result = execGh("gh auth status");
      expect(result).toContain("logged in");
    } finally {
      process.env.PATH = originalPath;
      rmSync(fakeBinDir, { recursive: true, force: true });
    }
  });

  it("throws error for invalid gh command", () => {
    expect(() => execGh("gh invalid-command")).toThrow("gh error");
  });
});
