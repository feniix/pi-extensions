import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { zstdDecompressSync } from "node:zlib";
import { stream as streamOpenAICodex } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { OPENAI_CODEX_MODELS } from "@earendil-works/pi-ai/providers/openai-codex.models";
import { describe, expect, it, vi } from "vitest";
import {
  createJournalPhaseBProviderBoundary,
  EvaluationProviderContextError,
  PHASE_B_UNTRUSTED_NOTICE,
  PROVIDER_ABORT_PAYLOAD,
} from "../extensions/evaluation-provider-context.js";
import { canonicalSha256 } from "../extensions/evaluation-receipts.js";

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const phaseBPrompt = "Continue the synthetic task from the trusted status boundary.";
const instructions = "You are the frozen synthetic evaluation agent.";
const tools = [
  {
    type: "function",
    name: "read",
    description: "Read a repository file",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
];
const capsule = JSON.stringify({
  notice: PHASE_B_UNTRUSTED_NOTICE,
  truncation: { truncated: false, byteLimit: 4000 },
  data: { checkpoint: { id: "checkpoint-current" } },
});

function user(content: string) {
  return { role: "user", content, timestamp: 10 };
}

function resume(content = capsule, sessionId = "journal-session") {
  return {
    role: "custom",
    customType: "agent-journal-resume",
    content,
    display: false,
    details: { sessionId, checkpointId: "checkpoint-current", fingerprint: "a".repeat(64) },
    timestamp: 11,
  };
}

function providerUser(text: string) {
  return { role: "user", content: [{ type: "input_text", text }] };
}

function payload(input: unknown[] = [providerUser(phaseBPrompt), providerUser(capsule)]) {
  return {
    model: "gpt-5.6-sol",
    store: false,
    stream: true,
    instructions,
    input,
    text: { verbosity: "low" },
    include: ["reasoning.encrypted_content"],
    prompt_cache_key: "phase-b-cache",
    tool_choice: "auto",
    parallel_tool_calls: true,
    tools: structuredClone(tools),
    reasoning: { effort: "high", summary: "auto" },
  };
}

function setup() {
  const failures: string[] = [];
  const boundary = createJournalPhaseBProviderBoundary({
    phaseBPrompt,
    expectedSessionId: "journal-session",
    expectedInstructionsDigest: sha256(instructions),
    expectedToolsDigest: canonicalSha256(tools).digest,
    expectedToolNames: ["read"],
    expectedPromptCacheKey: "phase-b-cache",
    transport: "sse",
    onTerminalFailure: (code) => failures.push(code),
  });
  return { boundary, failures };
}

describe("Agent Journal phase-B provider boundary", () => {
  it("filters every phase-A message kind and retains the current phase-B suffix", () => {
    const { boundary } = setup();
    const messages = [
      user("PHASE_A_USER_SECRET"),
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "PHASE_A_REASONING_SECRET" },
          { type: "toolCall", id: "call-old", name: "read", arguments: { path: "PHASE_A_TOOL_ARGUMENT" } },
        ],
        timestamp: 2,
      },
      {
        role: "toolResult",
        toolCallId: "call-old",
        toolName: "read",
        content: [{ type: "text", text: "PHASE_A_TOOL_RESULT" }],
      },
      { role: "compactionSummary", summary: "PHASE_A_COMPACTION_SECRET", tokensBefore: 100, timestamp: 3 },
      resume(JSON.stringify({ notice: PHASE_B_UNTRUSTED_NOTICE, data: "OLD_CAPSULE_SECRET" })),
      user(phaseBPrompt),
      resume(),
      { role: "assistant", content: [{ type: "text", text: "phase-B progress" }], timestamp: 12 },
      {
        role: "toolResult",
        toolCallId: "call-new",
        toolName: "read",
        content: [{ type: "text", text: "phase-B result" }],
      },
    ];

    const filtered = boundary.filterContext(messages);
    expect(filtered).toEqual(messages.slice(5));
    expect(JSON.stringify(filtered)).not.toMatch(/PHASE_A_|OLD_CAPSULE_SECRET/);

    const rebuilt = boundary.filterProviderPayload(
      payload([
        providerUser(phaseBPrompt),
        providerUser(capsule),
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "phase-B progress" }] },
        { type: "function_call_output", call_id: "call-new", output: "phase-B result" },
      ]),
    );
    expect(rebuilt).not.toBe(PROVIDER_ABORT_PAYLOAD);
    expect(JSON.stringify(rebuilt)).not.toMatch(/PHASE_A_|OLD_CAPSULE_SECRET/);
    expect((rebuilt as { input: unknown[] }).input).toHaveLength(4);
  });

  it.each([
    ["missing capsule", [user(phaseBPrompt)]],
    ["reversed boundary", [resume(), user(phaseBPrompt)]],
    ["interposed message", [user(phaseBPrompt), user("interposed"), resume()]],
    ["duplicate current capsule", [user(phaseBPrompt), resume(), resume()]],
    ["spoofed session", [user(phaseBPrompt), resume(capsule, "other-session")]],
    ["image-bearing prompt", [{ role: "user", content: [{ type: "image", data: "private" }] }, resume()]],
    [
      "oversized capsule",
      [user(phaseBPrompt), resume(JSON.stringify({ notice: PHASE_B_UNTRUSTED_NOTICE, data: "x".repeat(4001) }))],
    ],
    ["unlabeled capsule", [user(phaseBPrompt), resume(JSON.stringify({ notice: "trusted", data: null }))]],
  ])("fails closed for an invalid context boundary: %s", (_label, messages) => {
    const { boundary, failures } = setup();
    expect(boundary.filterContext(messages)).toEqual([]);
    expect(failures).toEqual(["invalid-context"]);
    expect(boundary.filterProviderPayload(payload())).toBe(PROVIDER_ABORT_PAYLOAD);
    expect(() => JSON.stringify(PROVIDER_ABORT_PAYLOAD)).toThrow(TypeError);
  });

  it("re-filters the original non-destructive context and rejects boundary drift", () => {
    const { boundary, failures } = setup();
    const original = [user("old"), user(phaseBPrompt), resume(), user("later phase-B message")];
    expect(boundary.filterContext(original)).toEqual(original.slice(1));
    expect(boundary.filterContext(original)).toEqual(original.slice(1));

    const drifted = structuredClone(original);
    (drifted[2] as unknown as { details: { fingerprint: string } }).details.fingerprint = "b".repeat(64);
    expect(boundary.filterContext(drifted)).toEqual([]);
    expect(failures).toEqual(["invalid-context"]);
  });

  it.each([
    "previous_response_id",
    "conversation",
    "messages",
    "history",
    "context",
    "prompt",
    "metadata",
    "future_field",
  ])("rejects the top-level history carrier %s", (field) => {
    const { boundary, failures } = setup();
    boundary.filterContext([user(phaseBPrompt), resume()]);
    const unsafe = { ...payload(), [field]: "PHASE_A_SECRET" };
    expect(boundary.filterProviderPayload(unsafe)).toBe(PROVIDER_ABORT_PAYLOAD);
    expect(failures).toEqual(["invalid-payload"]);
  });

  it("rejects an own __proto__ payload carrier instead of losing it during descriptor copying", () => {
    const { boundary, failures } = setup();
    boundary.filterContext([user(phaseBPrompt), resume()]);
    const unsafe = payload();
    Object.defineProperty(unsafe, "__proto__", {
      value: { history: "PHASE_A_SECRET" },
      enumerable: true,
      writable: true,
      configurable: true,
    });
    expect(boundary.filterProviderPayload(unsafe)).toBe(PROVIDER_ABORT_PAYLOAD);
    expect(failures).toEqual(["invalid-payload"]);
  });

  it("snapshots trusted configuration against post-construction mutation", () => {
    const failures: string[] = [];
    const options = {
      phaseBPrompt,
      expectedSessionId: "journal-session",
      expectedInstructionsDigest: sha256(instructions),
      expectedToolsDigest: canonicalSha256(tools).digest,
      expectedToolNames: ["read"],
      expectedPromptCacheKey: "phase-b-cache",
      transport: "sse" as const,
      onTerminalFailure: (code: string) => {
        failures.push(code);
      },
    };
    const boundary = createJournalPhaseBProviderBoundary(options);
    options.expectedInstructionsDigest = sha256(`${instructions} MUTATED_SECRET`);
    options.expectedToolsDigest = "b".repeat(64);
    options.expectedToolNames.push("bash");
    options.expectedPromptCacheKey = "mutated-cache";
    options.onTerminalFailure = () => undefined;

    boundary.filterContext([user(phaseBPrompt), resume()]);
    const unsafe = payload();
    unsafe.instructions = `${instructions} MUTATED_SECRET`;
    unsafe.prompt_cache_key = "mutated-cache";
    expect(boundary.filterProviderPayload(unsafe)).toBe(PROVIDER_ABORT_PAYLOAD);
    expect(failures).toEqual(["invalid-payload"]);
  });

  it("rejects provider items not derived from the filtered Agent-message suffix", () => {
    const { boundary, failures } = setup();
    boundary.filterContext([user("PHASE_A_SECRET"), user(phaseBPrompt), resume()]);
    const unsafe = payload([providerUser(phaseBPrompt), providerUser(capsule), providerUser("PHASE_A_SECRET")]);
    expect(boundary.filterProviderPayload(unsafe)).toBe(PROVIDER_ABORT_PAYLOAD);
    expect(boundary.getLastPayloadReceipt()).toBeNull();
    expect(failures).toEqual(["invalid-payload"]);
  });

  it("rebuilds same-length later input items from Agent messages instead of copying injected content", () => {
    const { boundary, failures } = setup();
    boundary.filterContext([
      user(phaseBPrompt),
      resume(),
      { role: "assistant", content: [{ type: "text", text: "safe phase-B progress" }], timestamp: 12 },
    ]);
    const unsafe = payload([
      providerUser(phaseBPrompt),
      providerUser(capsule),
      providerUser("PHASE_A_SAME_LENGTH_SECRET"),
    ]);
    const rebuilt = boundary.filterProviderPayload(unsafe);
    expect(rebuilt).not.toBe(PROVIDER_ABORT_PAYLOAD);
    expect(JSON.stringify(rebuilt)).toContain("safe phase-B progress");
    expect(JSON.stringify(rebuilt)).not.toContain("PHASE_A_SAME_LENGTH_SECRET");
    expect(failures).toEqual([]);
  });

  it("binds model, instructions, tools, tool names, prompt cache, reasoning, and provider input prefix", () => {
    const mutations: Array<(value: ReturnType<typeof payload>) => void> = [
      (value) => (value.model = "other-model"),
      (value) => (value.instructions = `${instructions}!`),
      (value) => value.tools.push({ ...tools[0], name: "bash" }),
      (value) => (value.prompt_cache_key = "old-session-cache"),
      (value) => (value.reasoning.effort = "low"),
      (value) => (value.input = [providerUser("old prompt"), providerUser(capsule)]),
      (value) => (value.input = [providerUser(phaseBPrompt), providerUser(`${capsule} `)]),
    ];
    for (const mutate of mutations) {
      const { boundary } = setup();
      boundary.filterContext([user(phaseBPrompt), resume()]);
      const candidate = payload();
      mutate(candidate);
      expect(boundary.filterProviderPayload(candidate)).toBe(PROVIDER_ABORT_PAYLOAD);
    }
  });

  it("rejects proxies and accessors without invoking traps or getters", () => {
    const trap = vi.fn();
    const getter = vi.fn(() => payload().model);
    const { boundary, failures } = setup();
    const proxiedMessage = new Proxy(user("old"), {
      get: trap,
      getOwnPropertyDescriptor: trap,
      ownKeys: trap,
      getPrototypeOf: trap,
    });
    expect(boundary.filterContext([proxiedMessage, user(phaseBPrompt), resume()])).toEqual([]);
    expect(trap).not.toHaveBeenCalled();

    const second = setup();
    second.boundary.filterContext([user(phaseBPrompt), resume()]);
    const proxiedPayload = new Proxy(payload(), {
      get: trap,
      getOwnPropertyDescriptor: trap,
      ownKeys: trap,
      getPrototypeOf: trap,
    });
    expect(second.boundary.filterProviderPayload(proxiedPayload)).toBe(PROVIDER_ABORT_PAYLOAD);
    expect(trap).not.toHaveBeenCalled();

    const accessorPayload = payload();
    Object.defineProperty(accessorPayload, "model", { enumerable: true, get: getter });
    const third = setup();
    third.boundary.filterContext([user(phaseBPrompt), resume()]);
    expect(third.boundary.filterProviderPayload(accessorPayload)).toBe(PROVIDER_ABORT_PAYLOAD);
    expect(getter).not.toHaveBeenCalled();
    expect(failures).toEqual(["invalid-context"]);
  });

  it("returns a frozen rebuilt body and a content-free exact-wire receipt", () => {
    const { boundary, failures } = setup();
    boundary.filterContext([user("phase A"), user(phaseBPrompt), resume()]);
    const rebuilt = boundary.filterProviderPayload(payload()) as ReturnType<typeof payload>;
    const bytes = JSON.stringify(rebuilt);
    const receipt = boundary.getLastPayloadReceipt();

    expect(Object.isFrozen(rebuilt)).toBe(true);
    expect(Object.isFrozen(rebuilt.input)).toBe(true);
    expect(receipt).toEqual({
      schemaVersion: 1,
      state: "filtered",
      model: "gpt-5.6-sol",
      transport: "sse",
      inputItems: 2,
      previousResponseIdPresent: false,
      byteLength: Buffer.byteLength(bytes, "utf8"),
      payloadDigest: sha256(bytes),
      instructionsDigest: sha256(instructions),
      toolsDigest: canonicalSha256(tools).digest,
      phaseBPromptDigest: sha256(phaseBPrompt),
      capsuleDigest: sha256(capsule),
    });
    expect(JSON.stringify(receipt)).not.toContain(phaseBPrompt);
    expect(JSON.stringify(receipt)).not.toContain(capsule);
    expect(failures).toEqual([]);
  });

  it("matches the exact logical body captured from the real Pi 0.80.6 Codex SSE serializer", async () => {
    let resolveCapture: (capture: { body: string; encoding: string | undefined }) => void = () => undefined;
    const captured = new Promise<{ body: string; encoding: string | undefined }>((resolve) => {
      resolveCapture = resolve;
    });
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const physical = Buffer.concat(chunks);
        const encoding = request.headers["content-encoding"];
        const logical = encoding === "zstd" ? zstdDecompressSync(physical) : physical;
        resolveCapture({ body: logical.toString("utf8"), encoding });
        response.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
        response.end(
          `data: ${JSON.stringify({
            type: "response.completed",
            response: {
              id: "response-synthetic",
              status: "completed",
              output: [],
              usage: {
                input_tokens: 0,
                output_tokens: 0,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens_details: { reasoning_tokens: 0 },
              },
            },
          })}\n\n`,
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("loopback server did not bind");
      const providerTools = [{ ...tools[0], strict: null }];
      const failures: string[] = [];
      const boundary = createJournalPhaseBProviderBoundary({
        phaseBPrompt,
        expectedSessionId: "journal-session",
        expectedInstructionsDigest: sha256(instructions),
        expectedToolsDigest: canonicalSha256(providerTools).digest,
        expectedToolNames: ["read"],
        expectedPromptCacheKey: "phase-b-cache",
        transport: "sse",
        onTerminalFailure: (code) => failures.push(code),
      });
      boundary.filterContext([user("PHASE_A_WIRE_SECRET"), user(phaseBPrompt), resume()]);
      const model = {
        ...OPENAI_CODEX_MODELS["gpt-5.6-sol"],
        baseUrl: `http://127.0.0.1:${address.port}`,
      };
      const stream = streamOpenAICodex(
        model,
        {
          systemPrompt: instructions,
          messages: [
            { role: "user", content: [{ type: "text", text: phaseBPrompt }], timestamp: 10 },
            { role: "user", content: [{ type: "text", text: capsule }], timestamp: 11 },
          ],
          tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
        },
        {
          apiKey: `e30.${Buffer.from(
            JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-account" } }),
          ).toString("base64url")}.signature`,
          transport: "sse",
          reasoningEffort: "high",
          sessionId: "phase-b-cache",
          maxRetries: 0,
          onPayload: (value) => boundary.filterProviderPayload(value),
        },
      );
      for await (const _event of stream) {
        // The synthetic 400 response terminates the stream after the request is captured.
      }
      if (failures.length > 0) throw new Error(`provider boundary failed with ${failures.join(",")}`);
      const capture = await captured;
      const receipt = boundary.getLastPayloadReceipt();
      expect(capture.encoding === undefined || capture.encoding === "zstd").toBe(true);
      expect(capture.body).not.toContain("PHASE_A_WIRE_SECRET");
      expect(JSON.parse(capture.body).input).toEqual([providerUser(phaseBPrompt), providerUser(capsule)]);
      expect(receipt?.payloadDigest).toBe(sha256(capture.body));
      expect(receipt?.byteLength).toBe(Buffer.byteLength(capture.body, "utf8"));
      expect(failures).toEqual([]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  }, 10_000);

  it("prevents the real Codex serializer from reaching fetch after a terminal boundary failure", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const { boundary } = setup();
      boundary.filterContext([user("missing capsule")]);
      const stream = streamOpenAICodex(
        OPENAI_CODEX_MODELS["gpt-5.6-sol"],
        { systemPrompt: instructions, messages: [{ role: "user", content: phaseBPrompt, timestamp: 10 }], tools: [] },
        {
          apiKey: `e30.${Buffer.from(
            JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-account" } }),
          ).toString("base64url")}.signature`,
          transport: "sse",
          maxRetries: 0,
          onPayload: (value) => boundary.filterProviderPayload(value),
        },
      );
      for await (const _event of stream) {
        // A serialization error is reported through the stream without a request.
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("normalizes callback failures and never returns the unsafe incoming payload", () => {
    const boundary = createJournalPhaseBProviderBoundary({
      phaseBPrompt,
      expectedSessionId: "journal-session",
      expectedInstructionsDigest: sha256(instructions),
      expectedToolsDigest: canonicalSha256(tools).digest,
      expectedToolNames: ["read"],
      expectedPromptCacheKey: "phase-b-cache",
      transport: "sse",
      onTerminalFailure: () => {
        throw new Error("callback secret");
      },
    });
    expect(() => boundary.filterContext([user("wrong")])).not.toThrow();
    expect(boundary.filterProviderPayload(payload())).toBe(PROVIDER_ABORT_PAYLOAD);
  });

  it.each(["auto", "websocket", "websocket-cached"] as const)("rejects non-SSE transport %s", (transport) => {
    expect(() =>
      createJournalPhaseBProviderBoundary({
        phaseBPrompt,
        expectedSessionId: "journal-session",
        expectedInstructionsDigest: sha256(instructions),
        expectedToolsDigest: canonicalSha256(tools).digest,
        expectedToolNames: ["read"],
        expectedPromptCacheKey: "phase-b-cache",
        transport,
        onTerminalFailure: () => undefined,
      }),
    ).toThrow(EvaluationProviderContextError);
  });
});
