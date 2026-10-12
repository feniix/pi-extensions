/**
 * Process identity for owner liveness. A pid alone can be reused after a crash; the pid's
 * start time distinguishes the original owner from an unrelated process that later got
 * the same pid.
 */
import { execFileSync } from "node:child_process";

/**
 * Start time of a process as reported by `ps`, or undefined where it cannot be read
 * (for example Windows). Undefined keeps the conservative pid-only liveness rule.
 */
export function processStartTime(pid: number): string | undefined {
  if (process.platform === "win32") return undefined;
  try {
    const value = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    }).trim();
    return value ? value.replace(/\s+/g, " ") : undefined;
  } catch {
    return undefined;
  }
}

let ownStart: string | undefined | null = null;

/** This process's start time, read once. */
export function ownProcessStartTime(): string | undefined {
  if (ownStart === null) ownStart = processStartTime(process.pid);
  return ownStart;
}

/**
 * Whether a recorded owner process is still the same live process. Only a proven-dead pid
 * (ESRCH) or a proven start-time mismatch (pid reuse) is dead; any other probe result,
 * including EPERM, is treated as live. Age alone never authorizes takeover.
 */
export function processAlive(pid: number, recordedStart?: string): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
    return code !== "ESRCH";
  }
  if (recordedStart === undefined) return true;
  const current = processStartTime(pid);
  return current === undefined || current === recordedStart;
}
