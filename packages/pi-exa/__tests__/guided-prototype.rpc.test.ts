/**
 * #171 process-level experiment: a real `pi --mode rpc` process loads the guided
 * prototype entry with the scripted model. The RPC client is the trusted
 * confirmation surface (extension_ui_request/response), drives prompts while the
 * mocked job is pending, completes it through the extension command, verifies the
 * persisted notice through get_entries, and replaces the session to observe the
 * shutdown fence and a declined approval.
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const entry = join(root, "packages", "pi-exa", "__tests__", "fixtures", "guided-prototype", "pi-entry.ts");

type Record = { type: string; id?: string; [key: string]: unknown };

class RpcPi {
  readonly records: Record[] = [];
  private readonly waiters: Array<{ predicate: (record: Record) => boolean; resolve: (record: Record) => void }> = [];
  private requestCount = 0;
  constructor(
    readonly child: ChildProcessWithoutNullStreams,
    readonly scratch: string,
  ) {
    createInterface({ input: child.stdout }).on("line", (line) => {
      let record: Record;
      try {
        record = JSON.parse(line) as Record;
      } catch {
        return;
      }
      this.records.push(record);
      for (const waiter of this.waiters.splice(0)) {
        if (waiter.predicate(record)) waiter.resolve(record);
        else this.waiters.push(waiter);
      }
    });
  }

  static async start(): Promise<RpcPi> {
    const packageDir = join(root, "node_modules", "@earendil-works", "pi-coding-agent");
    const manifest = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8")) as { bin: { pi: string } };
    const scratch = await mkdtemp(join(tmpdir(), "exa-guided-rpc-"));
    const home = join(scratch, "home");
    const agent = join(home, ".pi", "agent");
    const cwd = join(scratch, "repo");
    await Promise.all([mkdir(cwd), mkdir(agent, { recursive: true })]);
    const env = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: home,
      TMPDIR: scratch,
      PI_CODING_AGENT_DIR: agent,
      PI_OFFLINE: "1",
      PI_SKIP_VERSION_CHECK: "1",
      PI_TELEMETRY: "0",
      EXA_PROTO_SCRIPTED: "1",
      EXA_PROTO_BOUNDS: JSON.stringify({ initialDelayMs: 40, maxDelayMs: 80, jitterRatio: 0 }),
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
      "-e",
      entry,
      "--provider",
      "exa-proto",
      "--model",
      "scripted",
      "--thinking",
      "off",
    ];
    const child = spawn(process.execPath, args, { cwd, env, stdio: "pipe" });
    return new RpcPi(child, scratch);
  }

  send(record: Record): string {
    const id = record.id ?? `req-${++this.requestCount}`;
    this.child.stdin.write(`${JSON.stringify({ ...record, id })}\n`);
    return id;
  }

  waitFor(predicate: (record: Record) => boolean, ms = 15_000): Promise<Record> {
    const existing = this.records.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise<Record>((resolveWaiter, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `RPC wait timed out; last records: ${this.records
                .slice(-6)
                .map((r) => r.type)
                .join(", ")}`,
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

  /** Send a prompt and wait for the run to settle (or for an extension command to be handled). */
  async prompt(message: string): Promise<Record> {
    const settledBefore = this.records.filter((record) => record.type === "agent_settled").length;
    const id = this.send({ type: "prompt", message });
    const response = await this.waitFor((record) => record.type === "response" && record.id === id);
    const data = response.data as { disposition?: string } | undefined;
    if (data?.disposition === "handled") return response;
    await this.waitFor(() => this.records.filter((record) => record.type === "agent_settled").length > settledBefore);
    return response;
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

const running: RpcPi[] = [];
afterEach(async () => {
  for (const pi of running.splice(0)) await pi.stop();
});

describe("guided background research prototype in a real pi --mode rpc process", () => {
  it("confirms through the RPC extension UI, returns the pending run ID, delivers completion, fences shutdown and refuses a cancelled dialog", async () => {
    const pi = await RpcPi.start();
    running.push(pi);
    // Approve through the protocol: the client is the trusted surface.
    const approvals: Record[] = [];
    const dialog = pi.waitFor((record) => record.type === "extension_ui_request" && record.method === "confirm");
    void dialog.then((request) => {
      approvals.push(request);
      pi.send({ type: "extension_ui_response", id: request.id as string, confirmed: true });
    });
    await pi.prompt("research Laya versus Jev");
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ title: "Approve Exa research spending?", timeout: 600_000 });
    expect(String(approvals[0].message)).toContain("Laya versus Jev");
    const ack = pi.toolResults().at(-1) ?? "";
    expect(ack).toContain("Research started: run_1");
    expect(ack).toContain("status running");

    await pi.prompt("unrelated chat");
    expect(pi.toolResults()).toHaveLength(2);
    expect((await pi.entries()).some((entry) => entry.type === "custom_message")).toBe(false);

    // Extension commands execute immediately; completion wakes the assistant.
    const handled = await pi.prompt("/exa-proto complete run_1");
    expect(handled.data).toMatchObject({ disposition: "handled" });
    await pi.waitFor(
      (record) => record.type === "message_end" && (record.message as { role?: string }).role === "custom",
    );
    await pi.waitFor(() => pi.records.filter((record) => record.type === "agent_settled").length >= 3);
    const entries = await pi.entries();
    const notices = entries.filter((entry) => entry.type === "custom_message");
    expect(notices).toHaveLength(1);
    expect(notices[0].customType).toBe("exa-proto-completion");
    expect(entries.at(-1)?.type).toBe("message");
    const lastAssistant = pi.records
      .filter((record) => record.type === "message_end" && (record.message as { role?: string }).role === "assistant")
      .at(-1);
    if (!lastAssistant) throw new Error("Missing assistant message");
    expect(JSON.stringify((lastAssistant.message as { content: unknown }).content)).toContain("The research finished");

    // A second approved attempt is still pending when the session is replaced.
    void pi
      .waitFor(
        (record) =>
          record.type === "extension_ui_request" && record.method === "confirm" && !approvals.includes(record),
      )
      .then((request) => {
        approvals.push(request);
        pi.send({ type: "extension_ui_response", id: request.id as string, confirmed: true });
      });
    await pi.prompt("research Laya versus Jev again");
    expect(pi.toolResults().at(-1)).toContain("Research started: run_2");
    const newSession = pi.send({ type: "new_session" });
    await pi.waitFor((record) => record.type === "response" && record.id === newSession);
    const stateId = pi.send({ type: "prompt", message: "/exa-proto state" });
    await pi.waitFor((record) => record.type === "response" && record.id === stateId);
    const stateNotice = await pi.waitFor(
      (record) =>
        record.type === "extension_ui_request" &&
        record.method === "notify" &&
        String(record.message).includes('"attempts"'),
    );
    const state = JSON.parse(String(stateNotice.message)) as {
      attempts: Array<{ id: string; monitor: { state: string; reason?: string }; notice?: { state: string } }>;
      counters: { create: number; cancel: number };
    };
    expect(state.attempts.map((attempt) => attempt.id)).toEqual(["attempt_1", "attempt_2"]);
    expect(state.attempts[0].notice).toMatchObject({ state: "acknowledged" });
    expect(state.attempts[1].monitor).toMatchObject({ state: "paused", reason: "SHUTDOWN" });
    expect(state.attempts[1].notice).toBeUndefined();
    // The replaced runtime owns a fresh mock: the new session has created nothing.
    expect(state.counters).toMatchObject({ create: 0, cancel: 0 });

    // A cancelled dialog in the new session grants nothing.
    void pi
      .waitFor(
        (record) =>
          record.type === "extension_ui_request" && record.method === "confirm" && !approvals.includes(record),
      )
      .then((request) => {
        approvals.push(request);
        pi.send({ type: "extension_ui_response", id: request.id as string, cancelled: true });
      });
    await pi.prompt("research Laya versus Jev once more");
    expect(approvals).toHaveLength(3);
    expect(pi.toolResults().at(-1)).toContain("APPROVAL_NOT_GRANTED");
    const finalState = pi.send({ type: "prompt", message: "/exa-proto state" });
    await pi.waitFor((record) => record.type === "response" && record.id === finalState);
    const finalNotice = await pi.waitFor(
      (record) =>
        record.type === "extension_ui_request" &&
        record.method === "notify" &&
        String(record.message).includes('"attempts"') &&
        record !== stateNotice,
    );
    expect((JSON.parse(String(finalNotice.message)) as { counters: { create: number } }).counters.create).toBe(0);
    // Sanity: five settled runs and three dialogs crossed the real process boundary.
    expect(pi.records.filter((record) => record.type === "agent_settled").length).toBeGreaterThanOrEqual(5);
    expect(
      pi.records.filter((record) => record.type === "extension_ui_request" && record.method === "confirm"),
    ).toHaveLength(3);
  }, 60_000);
});
