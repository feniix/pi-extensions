import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import { zstdDecompressSync } from "node:zlib";
import type { ProviderPayloadReceipt } from "./evaluation-provider-context.js";

/**
 * Evaluation-only physical request witness. This observes one frozen SSE fetch
 * after provider filtering; it does not establish extension order, credentials,
 * provider authenticity, attempt scheduling, a real Pi runner lifecycle, or full
 * B3 acceptance by itself.
 */
const SHA256 = /^[a-f0-9]{64}$/;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_PHYSICAL_BYTES = 2 * 1024 * 1024;
const MAX_LOGICAL_BYTES = 1024 * 1024;
const PAYLOAD_KEYS = [
  "model",
  "store",
  "stream",
  "instructions",
  "input",
  "text",
  "include",
  "prompt_cache_key",
  "tool_choice",
  "parallel_tool_calls",
  "tools",
  "reasoning",
] as const;
const LOGICAL_RECEIPT_KEYS = [
  "schemaVersion",
  "state",
  "model",
  "transport",
  "inputItems",
  "previousResponseIdPresent",
  "byteLength",
  "payloadDigest",
  "instructionsDigest",
  "toolsDigest",
  "phaseBPromptDigest",
  "capsuleDigest",
] as const;

export type ProviderFetchFailureCode = "invalid-fetch" | "fetch-failed";
export type ProviderEndpointClass = "openai-codex" | "loopback";

export interface ProviderFetchWitnessOptions {
  attemptId: string;
  expectedUrl: string;
  endpointClass: ProviderEndpointClass;
  getLogicalReceipt: () => ProviderPayloadReceipt | null;
  fetchImpl: typeof fetch;
  onTerminalFailure: (code: ProviderFetchFailureCode) => void;
}

export interface ProviderFetchReceipt {
  schemaVersion: 1;
  state: "observed";
  attemptId: string;
  endpointClass: ProviderEndpointClass;
  model: "gpt-5.6-sol";
  transport: "sse";
  encoding: "identity" | "zstd";
  requestCount: 1;
  logicalDigest: string;
  logicalByteLength: number;
  physicalDigest: string;
  physicalByteLength: number;
  inputItems: number;
  previousResponseIdPresent: false;
}

export interface ProviderFetchWitness {
  fetch: typeof fetch;
  getReceipt(): ProviderFetchReceipt | null;
}

export class EvaluationProviderFetchWitnessError extends Error {
  constructor() {
    super("provider fetch witness rejected the request");
    this.name = "EvaluationProviderFetchWitnessError";
  }
}

type DataRecord = Record<string, unknown>;

function reject(): never {
  throw new EvaluationProviderFetchWitnessError();
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function dataRecord(value: unknown): DataRecord {
  if (
    !value ||
    typeof value !== "object" ||
    isProxy(value) ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    reject();
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) reject();
  const record: DataRecord = {};
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) reject();
    Object.defineProperty(record, key, {
      value: descriptor.value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return record;
}

function exactRecord(value: unknown, keys: readonly string[]): DataRecord {
  const record = dataRecord(value);
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([...keys].sort())) reject();
  return record;
}

function dataArray(value: unknown): unknown[] {
  if (!value || typeof value !== "object" || isProxy(value) || !Array.isArray(value)) reject();
  if (Object.getPrototypeOf(value) !== Array.prototype) reject();
  const keys = Reflect.ownKeys(value);
  const expected = [...Array.from({ length: value.length }, (_, index) => String(index)), "length"].sort();
  if (
    keys.some((key) => typeof key !== "string") ||
    JSON.stringify((keys as string[]).sort()) !== JSON.stringify(expected)
  ) {
    reject();
  }
  return value;
}

function boundedString(value: unknown, maxBytes: number): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") < 1 ||
    Buffer.byteLength(value, "utf8") > maxBytes
  ) {
    reject();
  }
  return value;
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) reject();
  return value as number;
}

function validateEndpoint(expectedUrl: string, endpointClass: ProviderEndpointClass): void {
  let parsed: URL;
  try {
    parsed = new URL(expectedUrl);
  } catch {
    reject();
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) reject();
  if (endpointClass === "openai-codex") {
    if (parsed.origin !== "https://chatgpt.com" || parsed.pathname !== "/backend-api/codex/responses") reject();
  } else if (
    parsed.protocol !== "http:" ||
    parsed.pathname !== "/codex/responses" ||
    (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost" && parsed.hostname !== "[::1]")
  ) {
    reject();
  }
}

function logicalReceipt(value: unknown): ProviderPayloadReceipt {
  const receipt = exactRecord(value, LOGICAL_RECEIPT_KEYS);
  if (
    receipt.schemaVersion !== 1 ||
    receipt.state !== "filtered" ||
    receipt.model !== "gpt-5.6-sol" ||
    receipt.transport !== "sse" ||
    receipt.previousResponseIdPresent !== false ||
    typeof receipt.payloadDigest !== "string" ||
    !SHA256.test(receipt.payloadDigest)
  ) {
    reject();
  }
  positiveInteger(receipt.inputItems);
  positiveInteger(receipt.byteLength);
  return receipt as unknown as ProviderPayloadReceipt;
}

function physicalBody(value: unknown): Buffer {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (!value || typeof value !== "object" || isProxy(value) || !(value instanceof Uint8Array)) reject();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Uint8Array.prototype && prototype !== Buffer.prototype) reject();
  return Buffer.from(value);
}

export function createProviderFetchWitness(options: ProviderFetchWitnessOptions): ProviderFetchWitness {
  const config = exactRecord(options, [
    "attemptId",
    "expectedUrl",
    "endpointClass",
    "getLogicalReceipt",
    "fetchImpl",
    "onTerminalFailure",
  ]);
  const attemptId = boundedString(config.attemptId, 128);
  const expectedUrl = boundedString(config.expectedUrl, 2048);
  const endpointClass = config.endpointClass;
  if (!OPAQUE_ID.test(attemptId) || (endpointClass !== "openai-codex" && endpointClass !== "loopback")) reject();
  validateEndpoint(expectedUrl, endpointClass);
  if (
    typeof config.getLogicalReceipt !== "function" ||
    typeof config.fetchImpl !== "function" ||
    typeof config.onTerminalFailure !== "function"
  ) {
    reject();
  }
  const getLogicalReceipt = config.getLogicalReceipt as () => ProviderPayloadReceipt | null;
  const fetchImpl = config.fetchImpl as typeof fetch;
  const onTerminalFailure = config.onTerminalFailure as (code: ProviderFetchFailureCode) => void;

  let terminal = false;
  let requestInProgress = false;
  let requestCount = 0;
  let receipt: ProviderFetchReceipt | null = null;

  const failClosed = (code: ProviderFetchFailureCode): never => {
    const notify = !terminal;
    terminal = true;
    receipt = null;
    if (notify) {
      try {
        onTerminalFailure(code);
      } catch {
        // The generic thrown error remains authoritative and content-free.
      }
    }
    reject();
  };

  const witnessedFetch: typeof fetch = async (input, init) => {
    if (terminal || requestInProgress || requestCount !== 0) failClosed("invalid-fetch");
    requestInProgress = true;
    try {
      let requestUrl: string;
      if (typeof input === "string") requestUrl = input;
      else {
        if (!(input instanceof URL) || isProxy(input) || Object.getPrototypeOf(input) !== URL.prototype) reject();
        requestUrl = URL.prototype.toString.call(input);
      }
      if (requestUrl !== expectedUrl || !init || isProxy(init)) reject();
      const request = dataRecord(init);
      if (request.method !== "POST") reject();
      if (!request.headers || typeof request.headers !== "object" || isProxy(request.headers)) reject();
      if (
        !(request.headers instanceof Headers) ||
        Object.getPrototypeOf(request.headers) !== Headers.prototype ||
        Reflect.ownKeys(request.headers).length !== 0
      ) {
        reject();
      }
      const rawEncoding = Headers.prototype.get.call(request.headers, "content-encoding");
      if (rawEncoding !== null && rawEncoding !== "zstd") reject();
      const encoding = rawEncoding === "zstd" ? "zstd" : "identity";
      const physical = physicalBody(request.body);
      if (physical.byteLength < 1 || physical.byteLength > MAX_PHYSICAL_BYTES) reject();
      const logical =
        encoding === "zstd"
          ? Buffer.from(zstdDecompressSync(physical, { maxOutputLength: MAX_LOGICAL_BYTES }))
          : Buffer.from(physical);
      if (logical.byteLength < 1 || logical.byteLength > MAX_LOGICAL_BYTES) reject();
      const text = logical.toString("utf8");
      if (!Buffer.from(text, "utf8").equals(logical)) reject();

      const expected = logicalReceipt(getLogicalReceipt());
      if (terminal) reject();
      if (expected.byteLength !== logical.byteLength || expected.payloadDigest !== sha256(logical)) reject();
      const payload: unknown = JSON.parse(text);
      const root = exactRecord(payload, PAYLOAD_KEYS);
      if (root.model !== "gpt-5.6-sol" || root.store !== false || root.stream !== true) reject();
      if (Object.hasOwn(root, "previous_response_id")) reject();
      const items = dataArray(root.input);
      if (items.length !== expected.inputItems) reject();

      requestCount = 1;
      receipt = Object.freeze({
        schemaVersion: 1,
        state: "observed",
        attemptId,
        endpointClass,
        model: "gpt-5.6-sol",
        transport: "sse",
        encoding,
        requestCount: 1,
        logicalDigest: expected.payloadDigest,
        logicalByteLength: logical.byteLength,
        physicalDigest: sha256(physical),
        physicalByteLength: physical.byteLength,
        inputItems: items.length,
        previousResponseIdPresent: false,
      });
      const forwardedInit = {
        ...request,
        headers: new Headers(request.headers),
        body: Buffer.from(physical),
      } as RequestInit;
      return await fetchImpl(requestUrl, forwardedInit);
    } catch {
      return failClosed(requestCount === 1 ? "fetch-failed" : "invalid-fetch");
    }
  };

  return Object.freeze({
    fetch: witnessedFetch,
    getReceipt: () => receipt,
  });
}
