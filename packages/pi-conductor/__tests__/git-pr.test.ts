import { execSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPreferredBaseBranch } from "../extensions/git-pr.js";

describe("git-pr helpers", () => {
  let repoDir: string;
  let remoteDir: string;

  beforeEach(() => {
    repoDir = execSync("mktemp -d", { encoding: "utf-8" }).trim();
    remoteDir = execSync("mktemp -d", { encoding: "utf-8" }).trim();
    execSync("git init -b main", { cwd: repoDir, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: repoDir, stdio: "pipe" });
    execSync("git config user.name 'Test User'", { cwd: repoDir, stdio: "pipe" });
    writeFileSync(join(repoDir, "README.md"), "hello\n");
    execSync("git add README.md", { cwd: repoDir, stdio: "pipe" });
    execSync("git commit -m 'initial commit'", { cwd: repoDir, stdio: "pipe" });
    execSync("git init --bare", { cwd: remoteDir, stdio: "pipe" });
    execSync(`git remote add origin ${remoteDir}`, { cwd: repoDir, stdio: "pipe" });
    execSync("git push -u origin main", { cwd: repoDir, stdio: "pipe" });
  });

  afterEach(() => {
    for (const dir of [repoDir, remoteDir]) {
      if (dir && existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("uses the current branch when it exists on origin", () => {
    execSync("git checkout -b feature/test-base", { cwd: repoDir, stdio: "pipe" });
    writeFileSync(join(repoDir, "feature.txt"), "feature\n");
    execSync("git add feature.txt", { cwd: repoDir, stdio: "pipe" });
    execSync("git commit -m 'feature commit'", { cwd: repoDir, stdio: "pipe" });
    execSync("git push -u origin feature/test-base", { cwd: repoDir, stdio: "pipe" });

    expect(getPreferredBaseBranch(repoDir)).toBe("feature/test-base");
  });

  it("falls back to the remote default branch when the current branch is only local", () => {
    execSync("git checkout -b feature/local-only", { cwd: repoDir, stdio: "pipe" });
    expect(getPreferredBaseBranch(repoDir)).toBe("main");
  });
});
