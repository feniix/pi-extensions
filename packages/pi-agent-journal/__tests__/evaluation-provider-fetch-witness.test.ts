import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
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
  it("attests the physical zstd body sent by the Pi 0.80.6 Codex SSE serializer", async () => {
    let receivedPhysical = Buffer.alloc(0);
    let receivedEncoding: string | undefined;
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        receivedPhysical = Buffer.concat(chunks);
        receivedEncoding = request.headers["content-encoding"];
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
      expect(receivedPhysical.byteLength).toBeGreaterThan(0);
      expect(receivedEncoding).toBe("zstd");
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
      expect(receipt?.physicalDigest).toBe(sha256(receivedPhysical));
      expect(receipt?.physicalByteLength).toBe(receivedPhysical.byteLength);
      const receivedLogical = zstdDecompressSync(receivedPhysical);
      expect(sha256(receivedLogical)).toBe(receipt?.logicalDigest);
      expect(receivedLogical.byteLength).toBe(receipt?.logicalByteLength);
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

  it("snapshots headers before receipt callbacks can mutate caller-owned state", async () => {
    const body = logicalBody();
    const headers = new Headers();
    let forwardedHeaders: Headers | undefined;
    const witness = createProviderFetchWitness({
      attemptId: "attempt-header-callback",
      expectedUrl: "https://chatgpt.com/backend-api/codex/responses",
      endpointClass: "openai-codex",
      getLogicalReceipt: () => {
        headers.set("content-encoding", "zstd");
        headers.set("x-injected", "private");
        return logicalReceipt(body);
      },
      fetchImpl: vi.fn(async (_input, init) => {
        forwardedHeaders = new Headers(init?.headers);
        return new Response("ok");
      }),
      onTerminalFailure: () => undefined,
    });
    await witness.fetch("https://chatgpt.com/backend-api/codex/responses", { method: "POST", headers, body });
    expect(witness.getReceipt()?.encoding).toBe("identity");
    expect(forwardedHeaders?.get("content-encoding")).toBeNull();
    expect(forwardedHeaders?.get("x-injected")).toBeNull();
  });

  it("rejects an own Headers.get override without invoking it", async () => {
    const trap = vi.fn((_name: string) => null);
    const headers = new Headers();
    Object.defineProperty(headers, "get", { value: trap, enumerable: false });
    const { witness, forwarded, body } = directSetup();
    await expect(
      witness.fetch("https://chatgpt.com/backend-api/codex/responses", { method: "POST", headers, body }),
    ).rejects.toThrow(EvaluationProviderFetchWitnessError);
    expect(trap).not.toHaveBeenCalled();
    expect(forwarded).not.toHaveBeenCalled();
  });

  it("rejects a URL subclass without invoking an overridden href getter", async () => {
    const trap = vi.fn(() => "https://chatgpt.com/backend-api/codex/responses");
    class HostileUrl extends URL {
      override get href(): string {
        return trap();
      }
    }
    const { witness, forwarded, body } = directSetup();
    await expect(
      witness.fetch(new HostileUrl("https://evil.invalid/responses"), {
        method: "POST",
        headers: new Headers(),
        body,
      }),
    ).rejects.toThrow(EvaluationProviderFetchWitnessError);
    expect(trap).not.toHaveBeenCalled();
    expect(forwarded).not.toHaveBeenCalled();
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

  it("fails the whole witness on callback reentry before either request forwards", async () => {
    const body = logicalBody();
    const forwarded = vi.fn(async () => new Response("ok"));
    let witness: ReturnType<typeof createProviderFetchWitness>;
    let inner: Promise<Response> | undefined;
    let recursing = false;
    witness = createProviderFetchWitness({
      attemptId: "attempt-reentrant",
      expectedUrl: "https://chatgpt.com/backend-api/codex/responses",
      endpointClass: "openai-codex",
      getLogicalReceipt: () => {
        if (!recursing) {
          recursing = true;
          inner = witness.fetch("https://chatgpt.com/backend-api/codex/responses", {
            method: "POST",
            headers: new Headers(),
            body,
          });
        }
        return logicalReceipt(body);
      },
      fetchImpl: forwarded,
      onTerminalFailure: () => undefined,
    });
    const outer = witness.fetch("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: new Headers(),
      body,
    });
    await expect(outer).rejects.toThrow(EvaluationProviderFetchWitnessError);
    await expect(inner).rejects.toThrow(EvaluationProviderFetchWitnessError);
    expect(forwarded).not.toHaveBeenCalled();
    expect(witness.getReceipt()).toBeNull();
  });

  it("clears evidence and fails terminally when the underlying fetch rejects", async () => {
    const failures: string[] = [];
    const body = logicalBody();
    const witness = createProviderFetchWitness({
      attemptId: "attempt-fetch-failure",
      expectedUrl: "https://chatgpt.com/backend-api/codex/responses",
      endpointClass: "openai-codex",
      getLogicalReceipt: () => logicalReceipt(body),
      fetchImpl: vi.fn(async () => {
        throw new Error("private transport detail");
      }),
      onTerminalFailure: (code) => failures.push(code),
    });
    await expect(
      witness.fetch("https://chatgpt.com/backend-api/codex/responses", {
        method: "POST",
        headers: new Headers(),
        body,
      }),
    ).rejects.toThrow("provider fetch witness rejected the request");
    expect(witness.getReceipt()).toBeNull();
    expect(failures).toEqual(["fetch-failed"]);
  });

  it("invalidates an in-flight first result when a concurrent second request is attempted", async () => {
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inFlightFetch = vi.fn(async () => {
      await pending;
      return new Response("ok");
    });
    const { witness, body, failures } = directSetup({ fetchImpl: inFlightFetch });
    const init = { method: "POST", headers: new Headers(), body };
    const first = witness.fetch("https://chatgpt.com/backend-api/codex/responses", init);
    const second = witness.fetch("https://chatgpt.com/backend-api/codex/responses", init);
    await expect(second).rejects.toThrow(EvaluationProviderFetchWitnessError);
    release();
    await expect(first).rejects.toThrow(EvaluationProviderFetchWitnessError);
    expect(inFlightFetch).toHaveBeenCalledTimes(1);
    expect(failures).toEqual(["invalid-fetch"]);
    expect(witness.getReceipt()).toBeNull();
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

  it("requires the exact frozen OpenAI Codex endpoint path", () => {
    expect(() =>
      createProviderFetchWitness({
        attemptId: "attempt-wrong-path",
        expectedUrl: "https://chatgpt.com/other",
        endpointClass: "openai-codex",
        getLogicalReceipt: () => logicalReceipt(),
        fetchImpl: globalThis.fetch,
        onTerminalFailure: () => undefined,
      }),
    ).toThrow(EvaluationProviderFetchWitnessError);
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
