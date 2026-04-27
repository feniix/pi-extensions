import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = join(__dirname, "..");

function parseFrontmatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  return Object.fromEntries(
    match[1]
      .split("\n")
      .map((line) => line.match(/^([a-zA-Z0-9_-]+):\s*(.+)$/))
      .filter((line): line is RegExpMatchArray => Boolean(line))
      .map((line) => [line[1], line[2].replace(/^"|"$/g, "")]),
  );
}

describe("pi-conductor package smoke", () => {
  it("publishes and registers packaged skills", () => {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8"));
    const skillsRoot = join(packageRoot, "skills");
    const skillDirectories = readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(packageJson.files).toContain("skills/");
    expect(packageJson.bin).toMatchObject({ "pi-conductor-runner": "./extensions/runner-cli.mjs" });
    expect(packageJson.pi.skills).toEqual(["./skills"]);
    expect(skillDirectories).toEqual(["conductor-gate-review", "conductor-orchestration"]);

    for (const skillDirectory of skillDirectories) {
      const skillPath = join(skillsRoot, skillDirectory, "SKILL.md");
      expect(existsSync(skillPath)).toBe(true);
      const skill = readFileSync(skillPath, "utf-8");
      const frontmatter = parseFrontmatter(skill);
      expect(frontmatter.name).toBe(skillDirectory);
      expect(frontmatter.description).toBeTruthy();
    }
  });

  it("executes the packaged runner CLI wrapper", () => {
    let status = 0;
    let output = "";
    try {
      execFileSync(process.execPath, [join(packageRoot, "extensions/runner-cli.mjs")], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 1;
      output = `${(error as { stdout?: string }).stdout ?? ""}${(error as { stderr?: string }).stderr ?? ""}`;
    }

    expect(status).toBe(1);
    expect(output).toContain("Usage: pi-conductor-runner run --contract");
  });

  it("keeps skill guidance aligned with the conductor safety workflow", () => {
    const gateReview = readFileSync(join(packageRoot, "skills/conductor-gate-review/SKILL.md"), "utf-8");
    const orchestration = readFileSync(join(packageRoot, "skills/conductor-orchestration/SKILL.md"), "utf-8");

    expect(gateReview).toContain("conductor_list_gates");
    expect(gateReview).toContain("conductor_prepare_human_review");
    expect(gateReview).toContain("/conductor human dashboard");
    expect(gateReview).toContain("Never approve high-risk gates through model-callable tools");

    expect(orchestration).toContain("conductor_scheduler_tick");
    expect(orchestration).toContain('policy: "execute"');
    expect(orchestration).toContain("conductor_reconcile_project");
    expect(orchestration).toContain("/conductor human dashboard");
  });
});
