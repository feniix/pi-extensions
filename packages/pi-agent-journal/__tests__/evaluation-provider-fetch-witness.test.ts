import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { zstdCompressSync } from "node:zlib";
import { stream as streamOpenAICodex } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { OPENAI_CODEX_MODELS } from "@earendil-works/pi-ai/providers/openai-codex.models";
import { describe, expect, it, vi } from "vitest";
import {
  createJournalPhaseBProviderBoundary,
  PHASE_B_UNTRUSTED_NOTICE,
} from "../extensions/evaluation-provider-context.js";
import {
  createProviderFetchWitness,
  EvaluationProviderFetchWitnessError,
} from "../extensions/evaluation-provider-fetch-witness.js";
import { canonicalSha256 } from "../extensions/evaluation-receipts.js";

const sha256 = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
const prompt = "Continue the synthetic task.";
const instructions = "Frozen synthetic instructions.";
const capsule = JSON.stringify({ notice: PHASE_B_UNTRUSTED_NOTICE, data: { checkpoint: "current" } });
const tools = [{ type: "function", name: "read", description: "Read", parameters: { type: "object" }, strict: null }];
const token = `e30.${Buffer.from(
  JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-account" } }),
).toString("base64url")}.signature`;

function user(content: string) {
  return { role: "user", content, timestamp: 10 };
}

function resume() {
  return {
    role: "custom",
    customType: "agent-journal-resume",
    content: capsule,
    display: false,
    details: { sessionId: "journal-session", checkpointId: "checkpoint-current", fingerprint: "a".repeat(64) },
    timestamp: 11,
  };
}

function providerBoundary() {
  return createJournalPhaseBProviderBoundary({
    phaseBPrompt: prompt,
    expectedSessionId: "journal-session",
    expectedInstructionsDigest: sha256(instructions),
    expectedToolsDigest: canonicalSha256(tools).digest,
    expectedToolNames: ["read"],
    expectedPromptCacheKey: "phase-b-cache",
    transport: "sse",
    onTerminalFailure: () => undefined,
  });
}

function logicalBody() {
  return JSON.stringify({
    model: "gpt-5.6-sol",
    store: false,
    stream: true,
    instructions,
    input: [
      { role: "user", content: [{ type: "input_text", text: prompt }] },
      { role: "user", content: [{ type: "input_text", text: capsule }] },
    ],
    text: { verbosity: "low" },
    include: ["reasoning.encrypted_content"],
    prompt_cache_key: "phase-b-cache",
    tool_choice: "auto",
    parallel_tool_calls: true,
    tools,
    reasoning: { effort: "high", summary: "auto" },
  });
}

function logicalReceipt(body = logicalBody()) {
  return {
    schemaVersion: 1 as const,
    state: "filtered" as const,
    model: "gpt-5.6-sol" as const,
    transport: "sse" as const,
    inputItems: 2,
    previousResponseIdPresent: false as const,
    byteLength: Buffer.byteLength(body, "utf8"),
    payloadDigest: sha256(body),
    instructionsDigest: sha256(instructions),
    toolsDigest: canonicalSha256(tools).digest,
    phaseBPromptDigest: sha256(prompt),
    capsuleDigest: sha256(capsule),
  };
}

function directSetup(overrides: Record<string, unknown> = {}) {
  const forwarded = vi.fn(async () => new Response("ok", { status: 200 }));
  const failures: string[] = [];
  const body = logicalBody();
  const witness = createProviderFetchWitness({
    attemptId: "attempt-001",
    expectedUrl: "https://chatgpt.com/backend-api/codex/responses",
    endpointClass: "openai-codex",
    getLogicalReceipt: () => logicalReceipt(body),
    fetchImpl: forwarded,
    onTerminalFailure: (code) => failures.push(code),
    ...overrides,
  });
  return { witness, forwarded, failures, body };
}

describe("Agent Journal provider fetch witness", () => {
  it("attests the physical zstd body sent by the real Pi 0.80.6 Codex SSE serializer", async () => {
    let received = false;
    const server = createServer((_request, response) => {
      received = true;
      response.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
      response.end(
        `data: ${JSON.stringify({
          type: "response.completed",
          response: {
            id: "response-synthetic",
            status: "completed",
            output: [],
            usage: { input_tokens: 0, output_tokens: 0, input_tokens_details: {}, output_tokens_details: {} },
          },
        })}\n\n`,
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const originalFetch = globalThis.fetch;
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("loopback did not bind");
      const expectedUrl = `http://127.0.0.1:${address.port}/codex/responses`;
      const boundary = providerBoundary();
      boundary.filterContext([user("PHASE_A_SECRET"), user(prompt), resume()]);
      const failures: string[] = [];
      const witness = createProviderFetchWitness({
        attemptId: "attempt-loopback",
        expectedUrl,
        endpointClass: "loopback",
        getLogicalReceipt: () => boundary.getLastPayloadReceipt(),
        fetchImpl: originalFetch,
        onTerminalFailure: (code) => failures.push(code),
      });
      vi.stubGlobal("fetch", witness.fetch);
      const stream = streamOpenAICodex(
        { ...OPENAI_CODEX_MODELS["gpt-5.6-sol"], baseUrl: `http://127.0.0.1:${address.port}` },
        {
          systemPrompt: instructions,
          messages: [
            { role: "user", content: prompt, timestamp: 10 },
            { role: "user", content: capsule, timestamp: 11 },
          ],
          tools: [{ name: "read", description: "Read", parameters: { type: "object" } }],
        },
        {
          apiKey: token,
          transport: "sse",
          reasoningEffort: "high",
          sessionId: "phase-b-cache",
          maxRetries: 0,
          onPayload: (value) => boundary.filterProviderPayload(value),
        },
      );
      for await (const _event of stream) {
        // Consume the synthetic terminal response.
      }
      const filtered = boundary.getLastPayloadReceipt();
      const receipt = witness.getReceipt();
      expect(received).toBe(true);
      expect(receipt).toMatchObject({
        schemaVersion: 1,
        state: "observed",
        attemptId: "attempt-loopback",
        endpointClass: "loopback",
        model: "gpt-5.6-sol",
        transport: "sse",
        encoding: "zstd",
        requestCount: 1,
        logicalDigest: filtered?.payloadDigest,
        logicalByteLength: filtered?.byteLength,
        inputItems: 2,
        previousResponseIdPresent: false,
      });
      expect(receipt?.physicalDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(receipt?.physicalByteLength).toBeGreaterThan(0);
      expect(JSON.stringify(receipt)).not.toContain(prompt);
      expect(JSON.stringify(receipt)).not.toContain(capsule);
      expect(failures).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it.each([
    ["wrong URL", { input: "https://evil.invalid/responses" }],
    ["wrong method", { init: { method: "GET" } }],
    ["unknown encoding", { headers: { "content-encoding": "gzip" } }],
    ["malformed JSON", { body: "{" }],
    ["logical digest mismatch", { receiptBody: `${logicalBody()} ` }],
  ])("rejects %s without forwarding", async (_label, mutation) => {
    const receiptBody = "receiptBody" in mutation ? mutation.receiptBody : logicalBody();
    const { witness, forwarded, failures } = directSetup({ getLogicalReceipt: () => logicalReceipt(receiptBody) });
    const input = "input" in mutation ? mutation.input : "https://chatgpt.com/backend-api/codex/responses";
    const headers = new Headers("headers" in mutation ? mutation.headers : undefined);
    const body = "body" in mutation ? mutation.body : logicalBody();
    const init = { method: "POST", headers, body, ...("init" in mutation ? mutation.init : {}) };
    await expect(witness.fetch(input, init)).rejects.toThrow(EvaluationProviderFetchWitnessError);
    expect(forwarded).not.toHaveBeenCalled();
    expect(failures).toEqual(["invalid-fetch"]);
    expect(witness.getReceipt()).toBeNull();
  });

  it("forwards private body and header copies rather than caller-retained references", async () => {
    const body = Buffer.from(logicalBody(), "utf8");
    const original = Buffer.from(body);
    const headers = new Headers({ "x-safe-metadata": "one" });
    let forwardedInit: RequestInit | undefined;
    const { witness } = directSetup({
      fetchImpl: vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
        forwardedInit = init;
        return new Response("ok");
      }),
    });
    await witness.fetch("https://chatgpt.com/backend-api/codex/responses", { method: "POST", headers, body });
    expect(forwardedInit?.body).not.toBe(body);
    expect(forwardedInit?.headers).not.toBe(headers);
    body.fill(0);
    headers.set("x-safe-metadata", "mutated");
    expect(Buffer.from(forwardedInit?.body as Uint8Array)).toEqual(original);
    expect(new Headers(forwardedInit?.headers).get("x-safe-metadata")).toBe("one");
  });

  it("rejects a Headers subclass without invoking its overridden get method", async () => {
    const trap = vi.fn((_name: string) => null);
    class HostileHeaders extends Headers {
      override get(name: string): string | null {
        trap(name);
        return null;
      }
    }
    const { witness, forwarded, body } = directSetup();
    await expect(
      witness.fetch("https://chatgpt.com/backend-api/codex/responses", {
        method: "POST",
        headers: new HostileHeaders(),
        body,
      }),
    ).rejects.toThrow(EvaluationProviderFetchWitnessError);
    expect(trap).not.toHaveBeenCalled();
    expect(forwarded).not.toHaveBeenCalled();
  });

  it("rejects a second provider request without forwarding it", async () => {
    const { witness, forwarded, body } = directSetup();
    const init = { method: "POST", headers: new Headers(), body };
    await witness.fetch("https://chatgpt.com/backend-api/codex/responses", init);
    await expect(witness.fetch("https://chatgpt.com/backend-api/codex/responses", init)).rejects.toThrow(
      EvaluationProviderFetchWitnessError,
    );
    expect(forwarded).toHaveBeenCalledTimes(1);
  });

  it("rejects previous_response_id and input-count drift from logical provider JSON", async () => {
    for (const mutate of [
      (value: Record<string, unknown>) => (value.previous_response_id = "old-response"),
      (value: Record<string, unknown>) => (value.input = []),
    ]) {
      const value = JSON.parse(logicalBody()) as Record<string, unknown>;
      mutate(value);
      const body = JSON.stringify(value);
      const { witness, forwarded } = directSetup({ getLogicalReceipt: () => logicalReceipt(body) });
      await expect(
        witness.fetch("https://chatgpt.com/backend-api/codex/responses", {
          method: "POST",
          headers: new Headers(),
          body,
        }),
      ).rejects.toThrow(EvaluationProviderFetchWitnessError);
      expect(forwarded).not.toHaveBeenCalled();
    }
  });

  it("bounds zstd decompression and normalizes callback failures", async () => {
    const large = Buffer.alloc(2 * 1024 * 1024, 65);
    const physical = zstdCompressSync(large);
    const { witness, forwarded } = directSetup({
      onTerminalFailure: () => {
        throw new Error("private callback detail");
      },
    });
    await expect(
      witness.fetch("https://chatgpt.com/backend-api/codex/responses", {
        method: "POST",
        headers: new Headers({ "content-encoding": "zstd" }),
        body: physical,
      }),
    ).rejects.toThrow("provider fetch witness rejected the request");
    expect(forwarded).not.toHaveBeenCalled();
  });
});
