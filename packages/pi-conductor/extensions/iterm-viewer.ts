import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ITERM_VIEWER_TIMEOUT_MS = 10_000;

export interface ItermViewerCommandAdapter {
  execFile(
    command: string,
    args: string[],
    options?: { cwd?: string; env?: NodeJS.ProcessEnv },
  ): Promise<{ stdout: string; stderr: string }>;
}

export type ItermViewerStatus = "opened" | "warning" | "unavailable";

export interface ItermViewerOpenResult {
  status: ItermViewerStatus;
  command: string;
  diagnostic: string | null;
}

export interface ItermViewerAvailability {
  available: boolean;
  diagnostic: string | null;
}

const defaultCommandAdapter: ItermViewerCommandAdapter = {
  async execFile(command, args, options) {
    const result = await execFileAsync(command, args, {
      cwd: options?.cwd,
      env: options?.env,
      timeout: ITERM_VIEWER_TIMEOUT_MS,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  },
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function inspectItermViewerAvailability(
  input: { platform?: NodeJS.Platform | string; probe?: () => void } = {},
): ItermViewerAvailability {
  const platform = input.platform ?? process.platform;
  if (platform !== "darwin") {
    return { available: false, diagnostic: "iTerm2 viewer is only available on macOS" };
  }
  const probe =
    input.probe ??
    (() =>
      execFileSync("osascript", ["-e", 'id of application "iTerm"'], {
        stdio: "ignore",
        timeout: ITERM_VIEWER_TIMEOUT_MS,
      }));
  try {
    probe();
    return { available: true, diagnostic: null };
  } catch (error) {
    return { available: false, diagnostic: `iTerm2 viewer is not available: ${errorMessage(error)}` };
  }
}

export function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n");
}

export function buildItermViewerScript(input: { attachCommand: string; title?: string | null }): string {
  const escapedCommand = escapeAppleScriptString(input.attachCommand);
  const escapedTitle = escapeAppleScriptString(input.title?.trim() || "pi-conductor worker");
  return [
    'tell application "iTerm"',
    "activate",
    "set conductorWindow to (create window with default profile)",
    "tell current session of conductorWindow",
    `set name to "${escapedTitle}"`,
    `write text "${escapedCommand}"`,
    "end tell",
    "end tell",
  ].join("\n");
}

export async function openItermTmuxViewer(input: {
  attachCommand: string;
  title?: string | null;
  platform?: NodeJS.Platform | string;
  adapter?: ItermViewerCommandAdapter;
}): Promise<ItermViewerOpenResult> {
  const platform = input.platform ?? process.platform;
  if (platform !== "darwin") {
    return {
      status: "unavailable",
      command: input.attachCommand,
      diagnostic: "iTerm2 viewer is only available on macOS; attach manually with the tmux command",
    };
  }

  const adapter = input.adapter ?? defaultCommandAdapter;
  const script = buildItermViewerScript({ attachCommand: input.attachCommand, title: input.title });
  try {
    await adapter.execFile("osascript", ["-e", script], undefined);
    return { status: "opened", command: input.attachCommand, diagnostic: null };
  } catch (error) {
    return {
      status: "warning",
      command: input.attachCommand,
      diagnostic: `iTerm2 viewer launch failed; attach manually with the tmux command: ${errorMessage(error)}`,
    };
  }
}
