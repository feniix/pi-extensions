import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    "vitest.terminal.config.ts",
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

describe("release publication tooling", () => {
  it("installs and verifies an OIDC-capable npm CLI after Node setup and before publishing", () => {
    const workflow = readFileSync(join(repo, ".github/workflows/release.yml"), "utf8");
    const publish = workflow.split("\n  publish:\n")[1]?.split("\n  publish_skipped:\n")[0] ?? "";
    const setup = publish.match(
      / {6}- name: Setup npm for trusted publishing\n {8}run: \|\n([\s\S]*?)(?=\n {6}- name:)/,
    );
    expect(setup, "publish must not rely on Node 22's bundled npm 10").not.toBeNull();
    const body = setup?.[1] ?? "";
    expect(body).toContain("npm install --global npm@11.21.0");
    expect(body).toContain('test "$(npm --version)" = "11.21.0"');
    expect(publish.indexOf("Setup npm for trusted publishing")).toBeGreaterThan(publish.indexOf("Setup Node.js"));
    expect(publish.indexOf("Setup npm for trusted publishing")).toBeLessThan(
      publish.indexOf("Publish changed packages"),
    );
    expect(publish).toContain('node-version: "22"');
    expect(publish).toContain("pnpm install --frozen-lockfile");
    expect(publish).toContain("npm publish --access public --provenance");
    expect(publish).toContain("environment: npm-release");
    expect(workflow).toContain("id-token: write");
  });
  it.each(["11.21.0", "10.9.9"])("verifies the npm binary actually selected on PATH (%s)", (version) => {
    const workflow = readFileSync(join(repo, ".github/workflows/release.yml"), "utf8");
    const body = workflow.match(
      / {6}- name: Setup npm for trusted publishing\n {8}run: \|\n([\s\S]*?)(?=\n {6}- name:)/,
    )?.[1];
    expect(body).toBeDefined();
    const cwd = fixture();
    executable(cwd, "npm", 'if [ "$1" = "--version" ]; then printf "%s\\n" "$NPM_VERSION"; else exit 0; fi');
    const result = spawnSync("bash", ["-c", body ?? ""], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, PATH: `${join(cwd, "bin")}:${process.env.PATH}`, NPM_VERSION: version },
    });
    expect(result.status).toBe(version === "11.21.0" ? 0 : 1);
    expect(result.stdout).toContain(version);
  });
});
