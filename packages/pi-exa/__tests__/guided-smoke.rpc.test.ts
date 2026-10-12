/**
 * #175 smoke: the complete guided journey on the production pi-exa extension in a
 * real `pi --mode rpc` process, with the real exa-js SDK pointed at a controllable
 * mock Exa HTTP server. Request → clarification/draft → readable proposal →
 * trusted approval over the protocol → immediate saved run ID → continued
 * conversation → background completion → findings/gaps/usage report.
 *
 * This is a mocked interactive smoke over the RPC host surface; it is not an
 * interactive TUI rendering check and performs no paid call.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type MockExaServer, startMockExaServer } from "./fixtures/guided-smoke/mock-exa-server.js";
import { RpcPi, repoRoot } from "./fixtures/rpc-pi.js";

const running: Array<{ stop: () => Promise<void> }> = [];
afterEach(async () => {
  for (const item of running.splice(0)) await item.stop().catch(() => {});
});

async function launch(server: MockExaServer, env: Record<string, string> = {}) {
  const pi = await RpcPi.start({
    prepare: async (scratch) => {
      await writeFile(
        join(scratch, "exa.json"),
        JSON.stringify({
          apiKey: "smoke-fixture-key",
          enabledTools: [
            "exa_research_step",
            "exa_research_status",
            "exa_research_summary",
            "exa_research_reset",
            "web_search_exa",
            "web_research_exa",
          ],
        }),
      );
    },
    env: { EXA_BASE_URL: server.baseUrl, ...env },
    // The documented value-taking flag is exercised in the real process (the config path is only
    // known after prepare(); the scratch layout puts it one level above the repo cwd).
    args: [
      "--exa-config-file",
      join("..", "exa.json"),
      "-e",
      join(repoRoot, "packages", "pi-exa", "extensions", "index.ts"),
      "-e",
      join(repoRoot, "packages", "pi-exa", "__tests__", "fixtures", "guided-smoke", "pi-entry.ts"),
      "--exa-enable-cycles",
      "--exa-monitor-interval-ms",
      "50",
      "--provider",
      "exa-smoke",
      "--model",
      "scripted",
      "--thinking",
      "off",
    ],
  });
  running.push(pi);
  return pi;
}

describe("guided background research smoke on the production extension (real pi RPC process, mock Exa endpoints)", () => {
  it("runs the whole journey without slash commands, schemas or hashes typed by the user, and reports after background completion", async () => {
    const server = await startMockExaServer();
    running.push({ stop: () => server.close() });
    const pi = await launch(server);
    const dialog = pi.answerNextConfirm("confirmed");
    await pi.prompt("research Laya versus Jev for small structured decisions", 30_000);
    const approval = await dialog;
    expect(approval).toMatchObject({ title: "Approve Exa research spending?", timeout: 600_000 });
    expect(String(approval.message)).toContain("Laya versus Jev");
    expect(String(approval.message)).toContain("estimate $0.10");

    // The assistant drove the cycle itself: start → step → proposal → submit.
    expect(pi.toolCalls()).toEqual([
      "exa_research_status",
      "exa_research_step",
      "exa_research_summary",
      "web_research_exa",
    ]);
    const results = pi.toolResults();
    expect(results[0]).toContain("Guided draft created without spending");
    expect(results[2]).toContain("Research proposal ");
    expect(results[2]).toContain("Estimated cost: $0.10");
    expect(results[2]).toContain("Nothing was submitted or approved");
    expect(results[3]).toContain("Research started: Exa run smoke_run_1");
    expect(results[3]).toContain("Background monitoring is registered");
    expect(pi.lastAssistantText()).toContain("Research started. I registered background monitoring");
    expect(server.counts()).toMatchObject({ creates: 1, other: 0 });
    expect(server.requests[0]).toMatchObject({ method: "POST", path: "/agent/runs", apiKey: "smoke-fixture-key" });
    expect(server.requests[0].body).toMatchObject({
      effort: "medium",
      metadata: expect.objectContaining({ revision: "1" }),
    });
    expect(server.runs.get("smoke_run_1")?.status).toBe("running");

    // The user keeps chatting while the mock job is pending and the monitor polls over HTTP.
    await pi.prompt("unrelated chat while it runs");
    expect(pi.lastAssistantText()).toContain("talk about something else");
    // HTTP polling produces no RPC records, so poll the server counter on a timer.
    await vi.waitFor(() => expect(server.counts().gets).toBeGreaterThanOrEqual(1), { timeout: 10_000, interval: 50 });
    expect((await pi.entries()).some((entry) => entry.type === "custom_message")).toBe(false);

    // Remote completion → persisted facts → one completion notice → wakeup → report turn.
    const settledBefore = pi.settledCount();
    server.complete("smoke_run_1");
    await pi.waitFor(
      (record) => record.type === "message_end" && (record.message as { role?: string }).role === "custom",
      15_000,
    );
    await pi.waitFor(() => pi.settledCount() > settledBefore, 15_000);
    const entries = await pi.entries();
    const notices = entries.filter((entry) => entry.type === "custom_message");
    expect(notices).toHaveLength(1);
    expect(notices[0].customType).toBe("exa-research-completion");
    expect(pi.toolCalls().at(-1)).toBe("exa_research_status");
    const report = pi.toolResults().at(-1) ?? "";
    expect(report).toContain("finalReport");
    expect(report).toMatch(/automaticCriterionSatisfaction\\?": false/);
    expect(report).toMatch(/billingVerified\\?": false/);
    expect(report).toContain("No latency benchmarks collected yet");
    expect(report).toContain("Completion blocks further submissions");
    expect(pi.lastAssistantText()).toContain("Report: the research finished");
    expect(server.counts()).toMatchObject({ creates: 1, other: 0 });
    // No user prompt was a slash command, no schema or hash was typed by the user.
    const userTexts = pi.records
      .filter((record) => record.type === "message_end" && (record.message as { role?: string }).role === "user")
      .map((record) => JSON.stringify((record.message as { content: unknown }).content));
    expect(userTexts.every((text) => !text.includes('"text":"/'))).toBe(true);
    expect(userTexts.join(" ")).not.toMatch(/[0-9a-f]{16}|draft-07/);
  }, 90_000);

  it("queues a completion that lands during an active response until the turn settles, then delivers one notice (production path)", async () => {
    const server = await startMockExaServer();
    running.push({ stop: () => server.close() });
    const pi = await launch(server, { EXA_SMOKE_LONG_REPLY: "1", EXA_SMOKE_TOKENS_PER_SECOND: "80" });
    const dialog = pi.answerNextConfirm("confirmed");
    await pi.prompt("research Laya versus Jev for small structured decisions", 30_000);
    await dialog;
    expect(server.counts().creates).toBe(1);
    // Start a long streamed reply, then complete the run while it is still streaming.
    const settledBefore = pi.settledCount();
    const streaming = pi.waitForNext((record) => record.type === "message_update", 15_000);
    pi.send({ type: "prompt", message: "tell me something long while it runs" });
    // Complete the run only once the long reply is actually streaming.
    await streaming;
    server.complete("smoke_run_1");
    await vi.waitFor(() => expect(server.counts().gets).toBeGreaterThanOrEqual(1), { timeout: 10_000, interval: 50 });
    // The notice is queued as a follow-up: it lands only after the streamed answer, then the report turn runs.
    await pi.waitFor(
      (record) => record.type === "message_end" && (record.message as { role?: string }).role === "custom",
      60_000,
    );
    await pi.waitFor(
      (record) =>
        record.type === "message_end" &&
        (record.message as { role?: string }).role === "assistant" &&
        JSON.stringify((record.message as { content: unknown }).content).includes("Report: the research finished"),
      60_000,
    );
    await pi.waitFor(() => pi.settledCount() > settledBefore, 30_000);
    const entries = await pi.entries();
    const kinds = entries.map((entry) =>
      entry.type === "message" ? entry.message?.role : entry.type === "custom_message" ? entry.customType : entry.type,
    );
    const noticeIndex = kinds.indexOf("exa-research-completion");
    expect(noticeIndex).toBeGreaterThan(-1);
    const longAnswerIndex = kinds.lastIndexOf("assistant", noticeIndex);
    const longAnswer = entries[longAnswerIndex] as { message?: { content: unknown } };
    expect(JSON.stringify(longAnswer.message?.content)).toContain("long digression");
    expect(entries.filter((entry) => entry.type === "custom_message")).toHaveLength(1);
    expect(pi.lastAssistantText()).toContain("Report: the research finished");
    expect(server.counts()).toMatchObject({ creates: 1, other: 0 });
  }, 120_000);

  it("a cancelled dialog in the same journey submits nothing", async () => {
    const server = await startMockExaServer();
    running.push({ stop: () => server.close() });
    const pi = await launch(server);
    const dialog = pi.answerNextConfirm("cancelled");
    await pi.prompt("research Laya versus Jev for small structured decisions", 30_000);
    await dialog;
    expect(pi.toolResults().at(-1)).toContain("APPROVAL_NOT_GRANTED");
    expect(server.counts()).toEqual({ creates: 0, gets: 0, other: 0 });
    expect(pi.lastAssistantText()).toContain("reported a pause");
  }, 60_000);
});
