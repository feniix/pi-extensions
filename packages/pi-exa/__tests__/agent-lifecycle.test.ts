import { afterEach, expect, it, vi } from "vitest";
import { resetExaClientCache } from "../extensions/exa-client.js";
import { AgentResearchTimeoutError, inspectResearchRun, performResearch } from "../extensions/web-research.js";

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

it("inspects exactly one existing pending run without creating, polling or cancelling research", async () => {
  sdk.get.mockResolvedValue({ id: "agent_run_existing", status: "running", costDollars: { total: 0.02 } });
  const events: unknown[] = [];
  const response = await inspectResearchRun("offline", "agent_run_existing", {
    observer: {
      beforeGet: async () => () => {},
      raw: async (phase, run) => {
        events.push([phase, run.id, run.status, run.costDollars?.total]);
      },
    },
  });
  expect(response.details).toMatchObject({
    runId: "agent_run_existing",
    remoteStatus: "running",
    inspectionOnly: true,
  });
  expect(events).toEqual([["get", "agent_run_existing", "running", 0.02]]);
  expect(sdk.get).toHaveBeenCalledExactlyOnceWith("agent_run_existing");
  expect(sdk.create).not.toHaveBeenCalled();
  expect(sdk.cancel).not.toHaveBeenCalled();
});

it.each([
  "timeout",
  "aborted",
])("keeps original GET observation attached after local inspection %s without remote cancellation", async (reason) => {
  vi.useFakeTimers();
  const signal = new AbortController();
  let resolve!: (run: { id: string; status: "completed"; costDollars: { total: number } }) => void;
  sdk.get.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const events: unknown[] = [];
  const pending = inspectResearchRun("offline", "agent_run_existing", {
    timeoutMs: 10,
    signal: signal.signal,
    observer: {
      beforeGet: async () => () => {},
      raw: async (phase, run) => {
        events.push([phase, run.status, run.costDollars?.total]);
      },
    },
  });
  const assertion = expect(pending).rejects.toThrow(/stopped locally.*no remote cancellation/i);
  await vi.advanceTimersByTimeAsync(0);
  if (reason === "timeout") await vi.advanceTimersByTimeAsync(10);
  else signal.abort();
  await assertion;
  resolve({ id: "agent_run_existing", status: "completed", costDollars: { total: 0 } });
  await vi.runAllTimersAsync();
  expect(events).toEqual([["get", "completed", 0]]);
  expect(sdk.get).toHaveBeenCalledTimes(1);
  expect(sdk.create).not.toHaveBeenCalled();
  expect(sdk.cancel).not.toHaveBeenCalled();
});

it("blocks GET on revoked final inspection guard or an already-aborted signal", async () => {
  const signal = new AbortController();
  signal.abort();
  await expect(inspectResearchRun("offline", "agent_run_existing", { signal: signal.signal })).rejects.toThrow(
    /stopped locally/,
  );
  await expect(
    inspectResearchRun("offline", "agent_run_existing", {
      observer: {
        beforeGet: async () => () => {
          throw new Error("revoked");
        },
        raw: async () => {},
      },
    }),
  ).rejects.toThrow("revoked");
  expect(sdk.get).not.toHaveBeenCalled();
  expect(sdk.create).not.toHaveBeenCalled();
});

it("never applies an unrelated GET reply or retries failed durable inspection observations", async () => {
  const raw = vi.fn();
  sdk.get.mockResolvedValueOnce({ id: "agent_run_other", status: "completed" });
  await expect(
    inspectResearchRun("offline", "agent_run_existing", {
      observer: { beforeGet: async () => () => {}, raw },
    }),
  ).rejects.toThrow(/identity conflict/i);
  expect(raw).not.toHaveBeenCalled();
  sdk.get.mockResolvedValueOnce({ id: "agent_run_existing", status: "completed" });
  raw.mockRejectedValueOnce(new Error("private storage failure"));
  await expect(
    inspectResearchRun("offline", "agent_run_existing", {
      observer: { beforeGet: async () => () => {}, raw },
    }),
  ).rejects.toThrow(/local durable observation failed.*Recover the existing run/);
  expect(sdk.get).toHaveBeenCalledTimes(2);
  expect(sdk.create).not.toHaveBeenCalled();
  expect(sdk.cancel).not.toHaveBeenCalled();
});

it("leaves unavailable GET outcomes unknown and rejects invalid path IDs without a request", async () => {
  sdk.get.mockRejectedValueOnce(Object.assign(new Error("Not found"), { statusCode: 404 }));
  await expect(inspectResearchRun("offline", "agent_run_existing")).rejects.toThrow("Not found");
  await expect(inspectResearchRun("offline", "../agent_run_existing")).rejects.toThrow(/Invalid Agent run ID/);
  expect(sdk.get).toHaveBeenCalledTimes(1);
  expect(sdk.create).not.toHaveBeenCalled();
  expect(sdk.cancel).not.toHaveBeenCalled();
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
