import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ownProcessStartTime, processAlive, processStartTime } from "../extensions/process-identity.js";
import { ownerAlive } from "../extensions/research-cycles.js";
import { withResearchStorageLock } from "../extensions/research-storage-lock.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const posix = process.platform !== "win32";

describe("process identity", () => {
  it.runIf(posix)("reads a stable start time for a live process", () => {
    const first = processStartTime(process.pid);
    expect(first).toMatch(/\d{4}/);
    expect(processStartTime(process.pid)).toBe(first);
    expect(ownProcessStartTime()).toBe(first);
  });

  it.runIf(posix)("treats a live pid with a different recorded start time as a reused, dead owner", () => {
    const start = ownProcessStartTime();
    expect(processAlive(process.pid, start)).toBe(true);
    expect(processAlive(process.pid, "Thu Jan  1 00:00:00 1970")).toBe(false);
    expect(ownerAlive({ pid: process.pid, processStart: "Thu Jan  1 00:00:00 1970" })).toBe(false);
    // Legacy records without a start time keep the conservative pid-only rule.
    expect(ownerAlive({ pid: process.pid })).toBe(true);
  });

  it.runIf(posix)("treats an exited process as dead", async () => {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    const pid = child.pid as number;
    await new Promise((resolve) => child.once("exit", resolve));
    expect(processAlive(pid)).toBe(false);
  });

  it.runIf(posix)("reclaims a storage lock left by a reused pid instead of blocking forever", async () => {
    const directory = await mkdtemp(join(tmpdir(), "exa-lock-reuse-"));
    directories.push(directory);
    // A crashed owner's lock whose pid now belongs to a different (live) process.
    await writeFile(
      join(directory, ".lock"),
      JSON.stringify({
        kind: "research-storage-lock-v1",
        pid: process.pid,
        token: "00000000-0000-4000-8000-000000000001",
        processStart: "Thu Jan  1 00:00:00 1970",
      }),
      { mode: 0o600 },
    );
    const value = await withResearchStorageLock(directory, async () => "acquired");
    expect(value).toBe("acquired");
    await expect(readFile(join(directory, ".lock"), "utf8")).rejects.toThrow();
  });

  it.runIf(posix)("still refuses a live owner's lock", async () => {
    const directory = await mkdtemp(join(tmpdir(), "exa-lock-live-"));
    directories.push(directory);
    await writeFile(
      join(directory, ".lock"),
      JSON.stringify({
        kind: "research-storage-lock-v1",
        pid: process.pid,
        token: "00000000-0000-4000-8000-000000000002",
        processStart: ownProcessStartTime(),
      }),
      { mode: 0o600 },
    );
    await expect(withResearchStorageLock(directory, async () => "acquired")).rejects.toThrow(/locked or unavailable/);
  });
});
