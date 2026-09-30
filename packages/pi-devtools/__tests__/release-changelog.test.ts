import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../../scripts/check-release-changelog.mjs", import.meta.url));
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "release-changelog-"));
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "@feniix/test", version: "1.2.3" }));
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

function check(changelog?: string) {
  if (changelog !== undefined) writeFileSync(join(directory, "CHANGELOG.md"), changelog);
  return spawnSync(process.execPath, [script, directory], { encoding: "utf8" });
}

describe("release changelog gate", () => {
  it("accepts the exact released version with a real date and notes, alongside Unreleased", () => {
    const result = check("# Changelog\n\n## [Unreleased]\n\n## [1.2.3] - 2026-09-30\n\n### Fixed\n\n- A bug.\n");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("@feniix/test@1.2.3");
  });

  it.each([
    ["missing file", undefined],
    ["unreleased version", "## [1.2.3] - Unreleased\n\n### Fixed\n\n- A bug.\n"],
    ["missing version", "## [1.2.2] - 2026-09-30\n\n### Fixed\n\n- A bug.\n"],
    ["invalid date", "## [1.2.3] - 2026-02-30\n\n### Fixed\n\n- A bug.\n"],
    ["empty notes", "## [1.2.3] - 2026-09-30\n\n### Fixed\n"],
    ["notes only in another version", "## [1.2.3] - 2026-09-30\n\n## [1.2.2] - 2026-09-29\n- A bug.\n"],
    ["duplicate version", "## [1.2.3] - Unreleased\n- A bug.\n\n## [1.2.3] - 2026-09-30\n- A bug.\n"],
    ["version prefix", "## [1.2.30] - 2026-09-30\n- A bug.\n"],
  ])("rejects %s", (_reason, changelog) => {
    const result = check(changelog);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CHANGELOG.md");
  });

  it("requires a package argument", () => {
    const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage:");
  });

  it.each([
    "pi-devtools",
    "pi-exa",
    "pi-notion",
    "pi-ref-tools",
    "pi-statusline",
  ])("ships a valid current changelog for %s", (name) => {
    const packagePath = fileURLToPath(new URL(`../../${name}/`, import.meta.url));
    const result = spawnSync(process.execPath, [script, packagePath], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const manifest = JSON.parse(readFileSync(join(packagePath, "package.json"), "utf8"));
    expect(manifest.files).toContain("CHANGELOG.md");
  });

  it("gates checks and revalidates immediately before publication", () => {
    const workflow = readFileSync(new URL("../../../.github/workflows/release.yml", import.meta.url), "utf8");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: This is a GitHub Actions expression.
    expect(workflow).toContain('node scripts/check-release-changelog.mjs "${{ matrix.package }}"');
    expect(workflow).toContain('node scripts/check-release-changelog.mjs "$pkg"');
    expect(workflow.indexOf('node scripts/check-release-changelog.mjs "$pkg"')).toBeLessThan(
      workflow.indexOf("npm publish"),
    );
  });
});
