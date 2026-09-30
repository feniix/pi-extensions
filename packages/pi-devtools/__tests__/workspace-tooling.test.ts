import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repo = resolve(import.meta.dirname, "../../..");
const fixtures: string[] = [];

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "pi-workspace-tooling-"));
  fixtures.push(cwd);
  mkdirSync(join(cwd, "bin"));
  for (const name of ["pi-one", "pi-two"]) {
    mkdirSync(join(cwd, "packages", name), { recursive: true });
    writeFileSync(join(cwd, "packages", name, "package.json"), JSON.stringify({ name: `@test/${name}` }));
  }
  return cwd;
}

function executable(cwd: string, name: string, body: string) {
  const path = join(cwd, "bin", name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

function run(cwd: string, script: string, env: Record<string, string> = {}) {
  return spawnSync("bash", [join(repo, "scripts", script), "base", "head"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PATH: `${join(cwd, "bin")}:${process.env.PATH}`, ...env },
  });
}

afterEach(() => {
  for (const cwd of fixtures.splice(0)) rmSync(cwd, { recursive: true, force: true });
});

describe("workspace CI detection", () => {
  it("ignores leftover directories without package manifests", () => {
    const cwd = fixture();
    mkdirSync(join(cwd, "packages", "pi-retired"));
    executable(cwd, "git", 'printf "%s\\n" "$CHANGED_FILES"');
    const result = run(cwd, "detect-ci-packages.sh", { CHANGED_FILES: "pnpm-lock.yaml" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('matrix=["pi-one","pi-two"]');
  });

  it.each([
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".npmrc",
    "scripts/audit-workspaces.sh",
    "package.json",
    "package-lock.json",
    "biome.json",
    "vitest.config.ts",
    ".github/workflows/ci.yml",
  ])("checks all packages when %s changes", (file) => {
    const cwd = fixture();
    executable(cwd, "git", 'printf "%s\\n" "$CHANGED_FILES"');
    const result = run(cwd, "detect-ci-packages.sh", { CHANGED_FILES: file });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('matrix=["pi-one","pi-two"]');
  });

  it.each([
    ["packages/pi-one/extensions/index.ts", 'matrix=["pi-one"]'],
    ["README.md", "matrix=[]"],
    ["", "matrix=[]"],
    ["tsconfig.json", 'matrix=["pi-one","pi-two"]'],
  ])("preserves selection for %s", (file, expected) => {
    const cwd = fixture();
    executable(cwd, "git", 'printf "%s\\n" "$CHANGED_FILES"');
    const result = run(cwd, "detect-ci-packages.sh", { CHANGED_FILES: file });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(expected);
  });

  it("propagates git failures", () => {
    const cwd = fixture();
    executable(cwd, "git", "exit 2");
    expect(run(cwd, "detect-ci-packages.sh").status).not.toBe(0);
  });
});

describe("workspace audit", () => {
  it.each([0, 1, 2])("audits the shared graph and propagates exit %s", (status) => {
    const cwd = fixture();
    executable(cwd, "pnpm", `printf "%s\\n" "$*"\nexit ${status}`);
    executable(cwd, "npm", "exit 0");
    const result = run(cwd, "audit-workspaces.sh");
    expect(result.status).toBe(status);
    expect(result.stdout.trim()).toBe("audit");
  });
});
