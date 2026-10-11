import { afterEach, expect, it, vi } from "vitest";
import { resetExaClientCache } from "../extensions/exa-client.js";
import { AgentResearchTimeoutError, performResearch } from "../extensions/web-research.js";

const sdk = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn(), cancel: vi.fn() }));
vi.mock("exa-js", () => ({
  Exa: class {
    agent = { runs: sdk };
  },
}));
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
  resetExaClientCache();
});

it("retains late create outcomes after the local timeout without creating replacement research", async () => {
  vi.useFakeTimers();
  let resolve!: (run: { id: string; status: "completed" }) => void;
  sdk.create.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const events: string[] = [];
  const pending = performResearch(
    "offline",
    { query: "question" },
    {
      timeoutMs: 10,
      observer: {
        beforeCreate: async () => () => {},
        raw: async (phase, run) => {
          events.push(`${phase}:${run.id}:${run.status}`);
        },
      },
    },
  );
  const assertion = expect(pending).rejects.toBeInstanceOf(AgentResearchTimeoutError);
  await vi.advanceTimersByTimeAsync(10);
  await assertion;
  resolve({ id: "agent_run_late", status: "completed" });
  await vi.runAllTimersAsync();
  expect(events).toEqual(["create:agent_run_late:completed"]);
  expect(sdk.create).toHaveBeenCalledTimes(1);
  expect(sdk.get).not.toHaveBeenCalled();
});

it("observes queued progress and terminal polling separately without hiding actual SDK costs", async () => {
  sdk.create.mockResolvedValue({ id: "agent_run_one", status: "queued", costDollars: { total: 0 } });
  sdk.get.mockResolvedValue({
    id: "agent_run_one",
    status: "completed",
    costDollars: { total: 0.1 },
    output: { structured: { answer: "result" } },
  });
  const events: unknown[] = [];
  await performResearch(
    "offline",
    { query: "question", outputSchema: { type: "object", properties: { answer: { type: "string" } } } },
    {
      observer: {
        beforeCreate: async () => () => {},
        raw: async (phase, run) => {
          events.push([phase, run.status, run.costDollars?.total]);
        },
      },
    },
  );
  expect(events).toEqual([
    ["create", "queued", 0],
    ["get", "completed", 0.1],
  ]);
});

it("observes the genuine cancellation reply despite a local cancellation error result", async () => {
  const signal = new AbortController();
  sdk.create.mockResolvedValue({ id: "agent_run_one", status: "queued" });
  sdk.cancel.mockResolvedValue({ id: "agent_run_one", status: "cancelled", costDollars: { total: 0.02 } });
  const events: string[] = [];
  await expect(
    performResearch(
      "offline",
      { query: "question" },
      {
        signal: signal.signal,
        observer: {
          beforeCreate: async () => () => {},
          raw: async (phase, run) => {
            events.push(`${phase}:${run.status}`);
            if (phase === "create") signal.abort();
          },
        },
      },
    ),
  ).rejects.toThrow("Cancelled.");
  expect(events).toEqual(["create:queued", "cancel:cancelled"]);
  expect(sdk.get).not.toHaveBeenCalled();
});

it("never dispatches when the final host guard rejects a revoked intent", async () => {
  await expect(
    performResearch(
      "offline",
      { query: "question" },
      {
        observer: {
          beforeCreate: async () => () => {
            throw new Error("revoked");
          },
          raw: async () => {},
        },
      },
    ),
  ).rejects.toThrow("revoked");
  expect(sdk.create).not.toHaveBeenCalled();
});

it("freezes nested SDK request fields before the asynchronous host dispatch guard", async () => {
  const rows = [{ name: "Alice" }];
  sdk.create.mockResolvedValue({
    id: "agent_run_one",
    status: "completed",
    output: { structured: { answer: "result" } },
  });
  await performResearch(
    "offline",
    {
      query: "question",
      input: { data: rows },
      outputSchema: { type: "object", properties: { answer: { type: "string" } } },
    },
    {
      observer: {
        beforeCreate: async () => {
          rows[0].name = "Bob";
          return () => {};
        },
        raw: async () => {},
      },
    },
  );
  expect(sdk.create).toHaveBeenCalledWith(expect.objectContaining({ input: { data: [{ name: "Alice" }] } }));
});

it("does not conceal a terminal poll observation failure behind transient network retries", async () => {
  sdk.create.mockResolvedValue({ id: "agent_run_one", status: "queued" });
  sdk.get.mockResolvedValue({ id: "agent_run_one", status: "completed" });
  await expect(
    performResearch(
      "offline",
      { query: "question" },
      {
        observer: {
          beforeCreate: async () => () => {},
          raw: async (phase) => {
            if (phase === "get") throw new Error("durability failed");
          },
        },
      },
    ),
  ).rejects.toThrow("Recover the existing run; do not resubmit");
  expect(sdk.get).toHaveBeenCalledTimes(1);
  expect(sdk.create).toHaveBeenCalledTimes(1);
});

it("observes the original terminal SDK outcome before local formatting failure", async () => {
  const events: string[] = [];
  sdk.create.mockImplementation(async () => {
    events.push("sdk");
    return { id: "agent_run_one", status: "completed", costDollars: { total: 0.1 } };
  });
  await expect(
    performResearch(
      "offline",
      {
        query: "question",
        outputSchema: { type: "object", properties: {} },
      },
      {
        observer: {
          beforeCreate: async () => () => {
            events.push("guard");
          },
          raw: async (phase, run) => {
            events.push(`${phase}:${run.id}:${run.status}`);
          },
        },
      },
    ),
  ).rejects.toThrow("completed without synthesized output");
  expect(events).toEqual(["guard", "sdk", "create:agent_run_one:completed"]);
});
