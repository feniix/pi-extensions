/**
 * Minimal RPC client for driving a real `pi --mode rpc` child process in tests.
 * The client is the trusted confirmation surface: it answers
 * extension_ui_request dialogs over the protocol.
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

export const repoRoot = resolve(import.meta.dirname, "../../../..");

export type RpcRecord = { type: string; id?: string; [key: string]: unknown };

export interface RpcPiOptions {
  /** Extra CLI arguments after the isolation flags. */
  args: string[];
  /** Extra environment variables. */
  env?: Record<string, string>;
  /** Optional setup hook receiving the scratch directory before launch. */
  prepare?: (scratch: string) => Promise<void>;
}

export class RpcPi {
  readonly records: RpcRecord[] = [];
  private readonly waiters: Array<{ predicate: (record: RpcRecord) => boolean; resolve: (record: RpcRecord) => void }> =
    [];
  private requestCount = 0;
  readonly stderr: string[] = [];

  constructor(
    readonly child: ChildProcessWithoutNullStreams,
    readonly scratch: string,
  ) {
    createInterface({ input: child.stdout }).on("line", (line) => {
      let record: RpcRecord;
      try {
        record = JSON.parse(line) as RpcRecord;
      } catch {
        return;
      }
      this.records.push(record);
      for (const waiter of this.waiters.splice(0)) {
        if (waiter.predicate(record)) waiter.resolve(record);
        else this.waiters.push(waiter);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => this.stderr.push(chunk.toString("utf8")));
  }

  static async start(options: RpcPiOptions): Promise<RpcPi> {
    const packageDir = join(repoRoot, "node_modules", "@earendil-works", "pi-coding-agent");
    const manifest = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8")) as { bin: { pi: string } };
    const scratch = await mkdtemp(join(tmpdir(), "exa-rpc-pi-"));
    const home = join(scratch, "home");
    const agent = join(home, ".pi", "agent");
    const cwd = join(scratch, "repo");
    await Promise.all([mkdir(cwd), mkdir(agent, { recursive: true })]);
    await options.prepare?.(scratch);
    const env = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: home,
      TMPDIR: scratch,
      PI_CODING_AGENT_DIR: agent,
      PI_OFFLINE: "1",
      PI_SKIP_VERSION_CHECK: "1",
      PI_TELEMETRY: "0",
      ...options.env,
    };
    const args = [
      join(packageDir, manifest.bin.pi),
      "--mode",
      "rpc",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      "--offline",
      "--session-dir",
      join(scratch, "sessions"),
      ...options.args,
    ];
    const child = spawn(process.execPath, args, { cwd, env, stdio: "pipe" });
    return new RpcPi(child, scratch);
  }

  send(record: RpcRecord): string {
    const id = record.id ?? `req-${++this.requestCount}`;
    this.child.stdin.write(`${JSON.stringify({ ...record, id })}\n`);
    return id;
  }

  waitFor(predicate: (record: RpcRecord) => boolean, ms = 15_000): Promise<RpcRecord> {
    const existing = this.records.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise<RpcRecord>((resolveWaiter, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `RPC wait timed out; last records: ${this.records
                .slice(-6)
                .map((record) => record.type)
                .join(", ")}; stderr: ${this.stderr.join("").slice(-400)}`,
            ),
          ),
        ms,
      );
      this.waiters.push({
        predicate,
        resolve: (record) => {
          clearTimeout(timer);
          resolveWaiter(record);
        },
      });
    });
  }

  settledCount(): number {
    return this.records.filter((record) => record.type === "agent_settled").length;
  }

  /** Send a prompt and wait for the run to settle (or for an extension command to be handled). */
  async prompt(message: string, ms = 15_000): Promise<RpcRecord> {
    const settledBefore = this.settledCount();
    const id = this.send({ type: "prompt", message });
    const response = await this.waitFor((record) => record.type === "response" && record.id === id, ms);
    const data = response.data as { disposition?: string } | undefined;
    if (data?.disposition === "handled") return response;
    await this.waitFor(() => this.settledCount() > settledBefore, ms);
    return response;
  }

  /** Answer the next confirm dialog with the given decision. */
  answerNextConfirm(decision: "confirmed" | "cancelled"): Promise<RpcRecord> {
    const seen = new Set(this.records.filter((record) => record.type === "extension_ui_request").map((r) => r.id));
    const request = this.waitFor(
      (record) => record.type === "extension_ui_request" && record.method === "confirm" && !seen.has(record.id),
    );
    void request
      .then((dialog) => {
        this.send(
          decision === "confirmed"
            ? { type: "extension_ui_response", id: dialog.id as string, confirmed: true }
            : { type: "extension_ui_response", id: dialog.id as string, cancelled: true },
        );
      })
      .catch(() => {
        /* The caller awaits the same promise and reports the timeout. */
      });
    return request;
  }

  async entries(): Promise<Array<{ type: string; customType?: string; message?: { role: string; content: unknown } }>> {
    const id = this.send({ type: "get_entries" });
    const response = await this.waitFor((record) => record.type === "response" && record.id === id);
    return (response.data as { entries: Array<{ type: string; customType?: string }> }).entries;
  }

  toolResults(): string[] {
    return this.records.flatMap((record) => {
      const message = record.message as { role?: string; content?: unknown } | undefined;
      return record.type === "message_end" && message?.role === "toolResult" ? [JSON.stringify(message.content)] : [];
    });
  }

  toolCalls(): string[] {
    return this.records.flatMap((record) => {
      const message = record.message as { role?: string; content?: Array<{ type: string; name?: string }> } | undefined;
      return record.type === "message_end" && message?.role === "assistant"
        ? (message.content ?? []).flatMap((block) => (block.type === "toolCall" && block.name ? [block.name] : []))
        : [];
    });
  }

  lastAssistantText(): string {
    const last = this.records
      .filter((record) => record.type === "message_end" && (record.message as { role?: string }).role === "assistant")
      .at(-1);
    return JSON.stringify((last?.message as { content: unknown } | undefined)?.content ?? "");
  }

  async stop(): Promise<void> {
    this.child.stdin.end();
    await new Promise<void>((done) => {
      const timer = setTimeout(() => {
        this.child.kill();
        done();
      }, 3_000);
      this.child.once("exit", () => {
        clearTimeout(timer);
        done();
      });
    });
    await rm(this.scratch, { recursive: true, force: true });
  }
}
