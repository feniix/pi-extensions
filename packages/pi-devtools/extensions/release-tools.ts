import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execGh, execGit } from "./git.js";
import { errorResult, shellQuote, successResult, type ToolResult } from "./shared.js";

export function parseConventionalCommit(message: string): { type: string; scope?: string; breaking: boolean } {
  const match = message.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
  if (!match) {
    return { type: "other", breaking: false };
  }
  return {
    type: match[1].toLowerCase(),
    scope: match[2],
    breaking: !!match[3] || message.includes("BREAKING CHANGE"),
  };
}

export function bumpVersion(version: string, type: "major" | "minor" | "patch"): string {
  const parts = version.replace(/^v/, "").split(".").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`Invalid version format: ${version}`);
  }

  const [major, minor, patch] = parts;
  switch (type) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

export function getLatestTagTool(): ToolResult {
  try {
    const tags = execGit("git tag -l 'v*' 'V*' | sort -rV | head -1");
    if (!tags) {
      return successResult("No version tags found.", { tag: null });
    }

    const commitCount = execGit(`git log ${tags}..HEAD --oneline | wc -l`).trim();
    return successResult(`Latest tag: ${tags}\nCommits since: ${commitCount}`, {
      tag: tags,
      commitsSince: parseInt(commitCount, 10),
    });
  } catch (error) {
    return errorResult("Failed to get latest tag", error);
  }
}

export function analyzeCommitsTool(): ToolResult {
  try {
    const tags = execGit("git tag -l 'v*' 'V*' | sort -rV | head -1");

    let commitsSince: string[];
    let currentVersion = "0.0.0";

    if (tags) {
      currentVersion = tags.replace(/^v/, "");
      commitsSince = execGit(`git log ${tags}..HEAD --format=\"%s\"`).split("\n").filter(Boolean);
    } else {
      commitsSince = execGit('git log --format="%s" -n 100').split("\n").filter(Boolean);
    }

    if (commitsSince.length === 0) {
      return successResult("No commits to analyze.", {
        type: "patch",
        commits: [],
        currentVersion,
        newVersion: currentVersion,
      });
    }

    const commitAnalysis = commitsSince.map((message) => ({
      message,
      ...parseConventionalCommit(message),
    }));

    let bumpType: "major" | "minor" | "patch" = "patch";
    for (const commit of commitAnalysis) {
      if (commit.breaking || commit.type.endsWith("!")) {
        bumpType = "major";
        break;
      }
      if (commit.type === "feat") {
        bumpType = "minor";
      }
    }

    const newVersion = bumpVersion(currentVersion, bumpType);
    const grouped = commitAnalysis.reduce(
      (acc, commit) => {
        const key = commit.type === "feat" ? "features" : commit.type === "fix" ? "fixes" : "other";
        if (!acc[key]) {
          acc[key] = [];
        }
        acc[key].push(commit.message);
        return acc;
      },
      {} as Record<string, string[]>,
    );

    const summary = Object.entries(grouped)
      .map(
        ([type, messages]) =>
          `### ${type.charAt(0).toUpperCase() + type.slice(1)}\n${messages.map((message) => `- ${message}`).join("\n")}`,
      )
      .join("\n\n");

    return successResult(
      `Commit Analysis:\n\n${summary}\n\n**Version:** ${currentVersion} → ${newVersion} (${bumpType} bump)`,
      { type: bumpType, commits: commitAnalysis, currentVersion, newVersion },
    );
  } catch (error) {
    return errorResult("Failed to analyze commits", error);
  }
}

export function bumpVersionTool(newVersion: string, file = "package.json"): ToolResult {
  try {
    if (!existsSync(file)) {
      return errorResult(`File not found: ${file}`, "file_not_found");
    }

    const pkg = JSON.parse(readFileSync(file, "utf-8"));
    if (typeof pkg.version !== "string") {
      return errorResult(`No version field found in ${file}`, "no_version_field");
    }

    const oldVersion = pkg.version;
    pkg.version = newVersion;
    writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8");

    return successResult(`Updated ${file}: ${oldVersion} → ${newVersion}`, { oldVersion, newVersion, file });
  } catch (error) {
    return errorResult("Failed to update version", error);
  }
}

export function createReleaseTool(
  tag: string,
  title: string,
  body?: string,
  draft = false,
  prerelease = false,
): ToolResult {
  try {
    let command = `gh release create ${shellQuote(tag)} --title ${shellQuote(title)}`;
    if (body) {
      command += ` --notes ${shellQuote(body)}`;
    }
    if (draft) {
      command += " --draft";
    }
    if (prerelease) {
      command += " --prerelease";
    }

    const releaseUrl = execGh(command);
    return successResult(`Created release: ${releaseUrl}\n\nTag: ${tag}\nTitle: ${title}`, { tag, title, releaseUrl });
  } catch (error) {
    return errorResult("Failed to create release", error);
  }
}
