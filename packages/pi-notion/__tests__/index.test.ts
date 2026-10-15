import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));

describe("pi-notion package", () => {
  it("has the expected name and a version", () => {
    expect(pkg.name).toBe("@feniix/pi-notion");
    expect(pkg.version).toBeTruthy();
  });

  it("loads one extension entry point and the skills", () => {
    expect(pkg.pi.extensions).toEqual(["./extensions/index.ts"]);
    expect(pkg.pi.skills).toEqual(["./skills"]);
  });

  it("has no runtime dependencies, since pi's built-in MCP support is the client", () => {
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it("ships the workspace-explorer skill; sign-in needs no skill", () => {
    expect(existsSync(join(__dirname, "../skills/setup-oauth"))).toBe(false);
    expect(existsSync(join(__dirname, "../skills/workspace-explorer/SKILL.md"))).toBe(true);
  });
});
