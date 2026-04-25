import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRunLockFile, mutateRunWithFileLock } from "../extensions/storage.js";

describe("conductor file mutation lock", () => {
  let conductorHome: string;

  beforeEach(() => {
    conductorHome = mkdtempSync(join(tmpdir(), "pi-conductor-home-"));
    process.env.PI_CONDUCTOR_HOME = conductorHome;
  });

  afterEach(() => {
    delete process.env.PI_CONDUCTOR_HOME;
    if (existsSync(conductorHome)) rmSync(conductorHome, { recursive: true, force: true });
  });

  it("releases the project lock after successful mutation", async () => {
    const updated = await mutateRunWithFileLock("abc", "/repo", (run) => ({ ...run, repoRoot: "/repo" }));

    expect(updated.projectKey).toBe("abc");
    expect(existsSync(getRunLockFile("abc"))).toBe(false);
  });

  it("does not enter mutator while another process lock exists", async () => {
    mkdirSync(dirname(getRunLockFile("abc")), { recursive: true });
    writeFileSync(getRunLockFile("abc"), "locked", "utf-8");
    let entered = false;

    await expect(
      mutateRunWithFileLock("abc", "/repo", (run) => {
        entered = true;
        return run;
      }),
    ).rejects.toThrow(/locked/i);

    expect(entered).toBe(false);
  });

  it("releases the project lock after failed mutation", async () => {
    await expect(
      mutateRunWithFileLock("abc", "/repo", () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow(/boom/);

    expect(existsSync(getRunLockFile("abc"))).toBe(false);
  });
});
