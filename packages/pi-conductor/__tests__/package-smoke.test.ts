import { execFileSync, type StdioOptions } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shellQuote } from "../extensions/tmux-runtime.js";

const packageRoot = join(__dirname, "..");
const TMUX_SMOKE_TIMEOUT_MS = 5_000;

function hasTmux(): boolean {
  try {
    execFileSync("tmux", ["-V"], { stdio: "ignore", timeout: TMUX_SMOKE_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

function runTmux(socketPath: string, args: string[], options: { stdio?: StdioOptions } = {}): void {
  execFileSync("tmux", ["-S", socketPath, ...args], {
    stdio: options.stdio ?? "pipe",
    timeout: TMUX_SMOKE_TIMEOUT_MS,
  });
}

async function waitForFileText(path: string, expected: string): Promise<string> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const text = readFileSync(path, "utf-8");
      if (text.includes(expected)) return text;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

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
  it("is loaded by root pi -e . extension configuration", () => {
    const rootPackageJson = JSON.parse(readFileSync(join(packageRoot, "../../package.json"), "utf-8"));

    expect(rootPackageJson.pi.extensions).toContain("./packages/pi-conductor/extensions/index.ts");
  });

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

  it.skipIf(!hasTmux())("smokes raw tmux session lifecycle used by visible supervision", async () => {
    const runtimeDir = mkdtempSync(join(tmpdir(), "pi-conductor-tmux-smoke-"));
    const socketPath = join(runtimeDir, "tmux.sock");
    const logPath = join(runtimeDir, "runner.log");
    const sessionName = `pi-cond-smoke-${process.pid}-${Date.now()}`;
    const script =
      "require('node:fs').writeFileSync(process.argv[1], 'pi-conductor smoke start\\n'); setTimeout(() => {}, 30000);";
    const command = `${shellQuote(process.execPath)} -e ${shellQuote(script)} ${shellQuote(logPath)}`;

    try {
      runTmux(socketPath, ["new-session", "-d", "-s", sessionName, command]);
      runTmux(socketPath, ["has-session", "-t", sessionName]);

      expect(await waitForFileText(logPath, "pi-conductor smoke start")).toContain("pi-conductor smoke start");

      runTmux(socketPath, ["kill-session", "-t", sessionName]);
      expect(() => runTmux(socketPath, ["has-session", "-t", sessionName], { stdio: "ignore" })).toThrow();
    } finally {
      try {
        runTmux(socketPath, ["kill-server"], { stdio: "ignore" });
      } catch {
        // Session may already be gone, which is the expected cleanup state.
      }
      rmSync(runtimeDir, { recursive: true, force: true });
    }
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
