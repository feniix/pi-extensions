import { execFileSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toolDefinitions } from "../extensions/index.js";

vi.mock("../extensions/git.js", () => ({
  execGit: vi.fn(),
  execGh: vi.fn(),
  getDefaultBranch: vi.fn().mockReturnValue("main"),
}));

import { execGh, execGit } from "../extensions/git.js";

const HELP_COMMANDS = [
  "gh pr create",
  "gh pr list",
  "gh pr view",
  "gh pr merge",
  "gh pr checks",
  "gh run list",
  "gh release create",
] as const;

const TOOL_COVERAGE = {
  devtools_create_branch: "git-integration",
  devtools_commit: "git-integration",
  devtools_push: "git-integration",
  devtools_create_pr: "gh-contract",
  devtools_merge_pr: "gh-contract",
  devtools_squash_merge_pr: "gh-contract",
  devtools_check_ci: "gh-contract",
  devtools_get_repo_info: "git-integration",
  devtools_get_latest_tag: "git-integration",
  devtools_analyze_commits: "git-integration",
  devtools_bump_version: "local-file",
  devtools_create_release: "gh-contract",
} as const satisfies Record<(typeof toolDefinitions)[number]["name"], string>;

function hasGhCli(): boolean {
  try {
    execFileSync("gh", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function ghHelp(command: (typeof HELP_COMMANDS)[number]): string {
  const args = command.split(" ").slice(1).concat("--help");
  return execFileSync("gh", args, { encoding: "utf-8" });
}

function helpCommandFor(ghCommand: string): (typeof HELP_COMMANDS)[number] {
  const match = HELP_COMMANDS.find((command) => ghCommand.startsWith(command));
  if (!match) {
    throw new Error(`No help command mapped for generated command: ${ghCommand}`);
  }
  return match;
}

function longFlags(command: string): string[] {
  return Array.from(new Set(command.match(/--[a-z][a-z-]*/g) ?? []));
}

function requestedJsonFields(command: string): string[] {
  const match = command.match(/--json\s+([A-Za-z0-9_,]+)/);
  return match ? match[1].split(",").filter(Boolean) : [];
}

function supportedJsonFields(help: string): Set<string> {
  const jsonSection = help.split("JSON FIELDS")[1]?.split(/\n\s*\n/)[0] ?? "";
  return new Set(jsonSection.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? []);
}

function toolByName(name: (typeof toolDefinitions)[number]["name"]): (typeof toolDefinitions)[number] {
  const tool = toolDefinitions.find((entry) => entry.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

async function executeTool(name: (typeof toolDefinitions)[number]["name"], params: Record<string, unknown> = {}) {
  return toolByName(name).execute("contract-test", params);
}

describe("pi-devtools generated CLI command contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(execGit).mockReset();
    vi.mocked(execGh).mockReset();
  });

  it("classifies every registered tool for command-contract coverage", () => {
    expect(new Set(Object.keys(TOOL_COVERAGE))).toEqual(new Set(toolDefinitions.map((tool) => tool.name)));
  });

  it("uses only gh flags and JSON fields supported by the installed gh CLI", async () => {
    if (!hasGhCli()) {
      if (process.env.CI) {
        throw new Error("GitHub CLI (`gh`) is required in CI to validate pi-devtools generated command contracts");
      }
      return;
    }

    const generatedCommands: string[] = [];
    vi.mocked(execGh).mockImplementation((command: string) => {
      generatedCommands.push(command);
      if (command.startsWith("gh pr list")) return JSON.stringify([{ number: 123 }]);
      if (command.startsWith("gh pr view")) {
        return JSON.stringify({ title: "Test PR", url: "https://github.com/owner/repo/pull/123", state: "OPEN" });
      }
      if (command.startsWith("gh pr create")) return "https://github.com/owner/repo/pull/124";
      if (command.startsWith("gh release create")) return "https://github.com/owner/repo/releases/tag/v1.2.3";
      if (command.startsWith("gh pr checks")) return JSON.stringify([]);
      if (command.startsWith("gh run list")) return JSON.stringify([]);
      return "";
    });
    vi.mocked(execGit).mockReturnValue("feature/devtools-command-contract");

    await executeTool("devtools_create_pr", {
      title: "Validate CLI flags",
      base: "main",
      draft: true,
      assignees: ["user1"],
    });
    await executeTool("devtools_merge_pr", { prNumber: 123, deleteBranch: true });
    await executeTool("devtools_merge_pr", {
      prNumber: 123,
      squash: true,
      commitTitle: "Squash title",
      commitMessage: "Squash body",
    });
    await executeTool("devtools_squash_merge_pr", { commitTitle: "Detected PR title", deleteBranch: false });
    await executeTool("devtools_check_ci", { prNumber: 123 });
    await executeTool("devtools_check_ci", { branch: "feature/devtools-command-contract" });
    await executeTool("devtools_create_release", {
      tag: "v1.2.3",
      title: "Version 1.2.3",
      body: "Release notes",
      draft: true,
      prerelease: true,
    });
    await executeTool("devtools_create_release", { tag: "v1.2.4", title: "Version 1.2.4" });

    expect(generatedCommands.some((command) => command.startsWith("gh pr create") && command.includes("--head"))).toBe(
      true,
    );
    expect(generatedCommands.some((command) => command.startsWith("gh pr create") && command.includes("--body"))).toBe(
      true,
    );
    expect(
      generatedCommands.some((command) => command.startsWith("gh release create") && command.includes("--notes")),
    ).toBe(true);

    const helpByCommand = new Map<(typeof HELP_COMMANDS)[number], string>();
    for (const command of generatedCommands) {
      const helpCommand = helpCommandFor(command);
      const help = helpByCommand.get(helpCommand) ?? ghHelp(helpCommand);
      helpByCommand.set(helpCommand, help);
      for (const flag of longFlags(command)) {
        expect(help, `${helpCommand} should support ${flag} used by ${command}`).toContain(flag);
      }

      const jsonFields = requestedJsonFields(command);
      if (jsonFields.length > 0) {
        const supportedFields = supportedJsonFields(help);
        for (const field of jsonFields) {
          expect(supportedFields, `${helpCommand} should support JSON field ${field} used by ${command}`).toContain(
            field,
          );
        }
      }
    }
  });
});
