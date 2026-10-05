import { type ChildProcessWithoutNullStreams, execFileSync, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Terminal } from "@xterm/headless";

type Options = {
  mode: "fullscreen" | "regular";
  theme: "dark" | "light";
  name?: string;
};

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/helper.ts", import.meta.url));
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** Real OS PTY via script(1); no npm native addons, build hooks, or user configuration. */
export class TerminalSession {
  private terminal = new Terminal({ cols: 140, rows: 30, allowProposedApi: true });
  private events = new EventEmitter();
  private writes: Promise<void> = Promise.resolve();
  private raw = "";
  private exited = false;
  private processError: Error | undefined;
  private artifacts: string;
  readonly version: string;

  private constructor(
    private child: ChildProcessWithoutNullStreams,
    private scratch: string,
    private stateFile: string,
    options: Options,
    version: string,
  ) {
    this.version = version;
    this.terminal.loadAddon(new Unicode11Addon());
    this.terminal.unicode.activeVersion = "11";
    this.artifacts = join(root, "coverage", "terminal", `${options.mode}-${options.theme}`, options.name ?? "session");
    this.terminal.onData((input) => {
      this.child.stdin.write(input);
    });
    this.child.stdin.on("error", () => {});
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const receive = (text: string) => {
      this.raw += text;
      this.writes = this.writes.then(
        () =>
          new Promise<void>((resolve) => {
            this.terminal.write(text, () => {
              this.events.emit("render");
              resolve();
            });
          }),
      );
    };
    child.stdout.on("data", receive);
    child.stderr.on("data", receive);
    child.on("error", (error) => {
      this.processError = error;
      this.events.emit("render");
    });
    child.on("exit", () => {
      this.exited = true;
      this.events.emit("render");
    });
  }

  static async start(options: Options): Promise<TerminalSession> {
    if (process.platform !== "darwin" && process.platform !== "linux") {
      throw new Error("Terminal smoke tests require macOS or Linux script(1) and stty(1)");
    }
    const packageDir = join(root, "node_modules", "@earendil-works", "pi-coding-agent");
    const manifest = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
    const cli = join(packageDir, manifest.bin.pi);
    const scratch = await mkdtemp(join(tmpdir(), "pi-statusline-terminal-"));
    const cwd = join(scratch, "repo");
    const home = join(scratch, "home");
    const agent = join(home, ".pi", "agent");
    const stateFile = join(scratch, "state.json");
    try {
      await Promise.all([mkdir(cwd), mkdir(agent, { recursive: true })]);
      const env = {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: home,
        TMPDIR: scratch,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        LANG: "C.UTF-8",
        PI_CODING_AGENT_DIR: agent,
        PI_OFFLINE: "1",
        PI_SKIP_VERSION_CHECK: "1",
        PI_TELEMETRY: "0",
        PI_IMAGE_PROTOCOL: "none",
        PI_HYPERLINKS: "0",
        STATUSLINE_SMOKE_STATE: stateFile,
      };
      execFileSync("git", ["init", "-q", "--initial-branch=smoke"], { cwd, env });
      const args = [
        process.execPath,
        cli,
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-context-files",
        "--no-session",
        "--offline",
        "-e",
        join(root, "packages", "pi-statusline", "extensions", "index.ts"),
        "-e",
        fixture,
        "--provider",
        "statusline-smoke",
        "--model",
        "smoke-model",
        "--thinking",
        "medium",
        "--tui-mode",
        options.mode,
        "--use-theme",
        options.theme,
      ];
      const command = `stty cols 140 rows 30; exec ${args.map(quote).join(" ")}`;
      const scriptArgs =
        process.platform === "darwin" ? ["-q", "/dev/null", "/bin/sh", "-c", command] : ["-qefc", command, "/dev/null"];
      // Node uses socketpairs for child stdio. BSD script accepts pipes but rejects
      // socketpairs with ENOTSUP, so cat supplies a real OS pipe on macOS.
      const child =
        process.platform === "darwin"
          ? spawn("/bin/sh", ["-c", `cat | script ${scriptArgs.map(quote).join(" ")}`], { cwd, env, stdio: "pipe" })
          : spawn("script", scriptArgs, { cwd, env, stdio: "pipe" });
      return new TerminalSession(child, scratch, stateFile, options, manifest.version);
    } catch (error) {
      await rm(scratch, { recursive: true, force: true });
      throw error;
    }
  }

  screen(): string[] {
    const buffer = this.terminal.buffer.active;
    return Array.from(
      { length: this.terminal.rows },
      (_, row) => buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? "",
    );
  }

  footer(): string[] {
    const lines = this.screen();
    const starts = lines.flatMap((line, index) => (/^(Model:|Ctx:)/.test(line) ? [index] : []));
    if (starts.length !== 1) return [];
    return lines.slice(starts[0], starts[0] + 2);
  }

  cellWidth(text: string): number | undefined {
    const buffer = this.terminal.buffer.active;
    for (let row = 0; row < this.terminal.rows; row += 1) {
      const line = buffer.getLine(buffer.viewportY + row);
      for (let column = 0; column < this.terminal.cols; column += 1) {
        const cell = line?.getCell(column);
        if (cell?.getChars() === text) return cell.getWidth();
      }
    }
    return undefined;
  }

  modelColor(): { rgb: boolean; value: number } | undefined {
    const row = this.screen().findIndex((line) => line.startsWith("Model:"));
    const cell = this.terminal.buffer.active.getLine(this.terminal.buffer.active.viewportY + row)?.getCell(0);
    return row >= 0 && cell ? { rgb: cell.isFgRGB(), value: cell.getFgColor() } : undefined;
  }

  modelRequestAttempted(): boolean {
    return this.raw.includes("UNEXPECTED_SMOKE_MODEL_REQUEST");
  }

  async command(text: string): Promise<void> {
    this.child.stdin.write(text);
    await this.waitFor(`typed-${text}`, (screen) => screen.includes(text));
    this.child.stdin.write("\r");
  }

  key(text: string): void {
    this.child.stdin.write(text);
  }

  async resize(width: number): Promise<void> {
    this.terminal.resize(width, 30);
    await this.command(`/smoke-resize ${width}`);
    await this.waitFor(`resized-${width}`, (screen) => screen.includes(`W${width}`));
  }

  async waitFor(name: string, predicate: (screen: string) => boolean, timeout = 8_000): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          clearTimeout(timer);
          this.events.off("render", inspect);
          if (error) reject(error);
          else resolve();
        };
        const inspect = () => {
          if (this.processError) return finish(this.processError);
          if (/UNEXPECTED_SMOKE_MODEL_REQUEST|Extension Error|Failed to load extension/.test(this.raw)) {
            return finish(new Error(`Unexpected runtime error during ${name}`));
          }
          if (this.exited) return finish(new Error(`pi exited before ${name}`));
          try {
            if (predicate(this.screen().join("\n"))) finish();
          } catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)));
          }
        };
        const timer = setTimeout(() => finish(new Error(`Timed out waiting for ${name}`)), timeout);
        this.events.on("render", inspect);
        inspect();
      });
      await this.save(name);
    } catch (error) {
      await this.save(`FAILED-${name}`);
      throw error;
    }
  }

  private async save(name: string) {
    await mkdir(this.artifacts, { recursive: true });
    await writeFile(join(this.artifacts, `${name.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}.txt`), this.screen().join("\n"));
    await writeFile(join(this.artifacts, "terminal.ansi"), this.raw);
  }

  async close(): Promise<void> {
    if (!this.exited) {
      this.child.stdin.end("\x04");
      await new Promise<void>((resolve) => {
        if (this.exited) return resolve();
        const timer = setTimeout(resolve, 2_000);
        this.child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    if (!this.exited) {
      try {
        const { pid } = JSON.parse(await readFile(this.stateFile, "utf8"));
        if (Number.isInteger(pid) && pid > 1 && pid !== process.pid) process.kill(pid, "SIGTERM");
      } catch {}
      this.child.kill("SIGTERM");
    }
    await this.writes;
    await this.save("final");
    this.terminal.dispose();
    this.child.stdin.destroy();
    this.child.stdout.destroy();
    this.child.stderr.destroy();
    await rm(this.scratch, { recursive: true, force: true });
  }
}
