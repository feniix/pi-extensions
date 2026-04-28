import { execFileSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkCiTool, createPrTool, createReleaseTool, mergePrTool } from "../extensions/index.js";

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

describe("pi-devtools generated GitHub CLI command contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(execGit).mockReset();
    vi.mocked(execGh).mockReset();
  });

  it.skipIf(!hasGhCli())("uses only long flags supported by the installed gh CLI", () => {
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

    createPrTool("Validate CLI flags", "Body", "main", true, ["user1"]);
    mergePrTool(123, false, true);
    mergePrTool(123, true, true, "Squash title", "Squash body");
    mergePrTool(undefined, true, false, "Detected PR title");
    checkCiTool(123);
    checkCiTool(undefined, "feature/devtools-command-contract");
    createReleaseTool("v1.2.3", "Version 1.2.3", "Release notes", true, true);

    const helpByCommand = new Map<(typeof HELP_COMMANDS)[number], string>();
    for (const command of generatedCommands) {
      const helpCommand = helpCommandFor(command);
      const help = helpByCommand.get(helpCommand) ?? ghHelp(helpCommand);
      helpByCommand.set(helpCommand, help);
      for (const flag of longFlags(command)) {
        expect(help, `${helpCommand} should support ${flag} used by ${command}`).toContain(flag);
      }
    }
  });
});
