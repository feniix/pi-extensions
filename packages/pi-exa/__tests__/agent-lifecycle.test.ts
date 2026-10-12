import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { resetExaClientCache } from "../extensions/exa-client.js";
import { createResearchCycles } from "../extensions/research-cycles.js";
import { agentRequestHash } from "../extensions/research-execution.js";
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

it("uses the real controller fences for two explicitly funded SDK creates after confirmed failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "exa-retry-sdk-"));
  const cycles = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "sdk-test" });
  try {
    const cycle = await cycles.start("question");
    await cycles.recordStep({
      topic: "question",
      stage: "source_retrieval",
      note: "Prepare",
      thought_number: 1,
      total_thoughts: 1,
      next_step_needed: false,
      executionPlan: {
        goal: "answer",
        taskSchema: {
          type: "object",
          required: ["answer"],
          properties: { answer: { type: "string" } },
          additionalProperties: false,
        },
      },
    });
    const artifact = await cycles.preview();
    const hash = agentRequestHash(artifact.request);
    await cycles.grantBudget(cycle.id, 1, ["web_research_exa"]);
    await cycles.grantUncertainty(cycle.id, "request", hash, 0.2);
    sdk.create
      .mockResolvedValueOnce({ id: "agent_run_first_failed", status: "failed", costDollars: { total: 0.01 } })
      .mockResolvedValueOnce({
        id: "agent_run_second_success",
        status: "completed",
        costDollars: { total: 0.1 },
        output: { structured: { answer: "funded retry" } },
      });
    const first = (await cycles.reserveAgent()).attempt;
    const firstObserver = cycles.agentLifecycleObserver(cycle.id, first.id, hash);
    if (typeof artifact.request.query !== "string") throw new Error("Compiled query missing");
    await expect(
      performResearch("offline", { ...artifact.request, query: artifact.request.query }, { observer: firstObserver }),
    ).rejects.toThrow(/failed/);
    await firstObserver.finish();
    expect((await cycles.status())?.status).toBe("failed");
    await expect(cycles.reserveAgent({}, "retry")).rejects.toThrow("UNCERTAINTY_APPROVAL_REQUIRED");
    expect(sdk.create).toHaveBeenCalledTimes(1);
    await cycles.grantUncertainty(cycle.id, "request", hash, 0.2);
    const second = (await cycles.reserveAgent({}, "retry")).attempt;
    const secondObserver = cycles.agentLifecycleObserver(cycle.id, second.id, hash);
    await performResearch(
      "offline",
      { ...artifact.request, query: artifact.request.query },
      { observer: secondObserver },
    );
    await secondObserver.finish();
    expect(sdk.create).toHaveBeenCalledTimes(2);
    expect(sdk.create.mock.calls[1][0]).toEqual(second.artifact.request);
    expect(sdk.get).not.toHaveBeenCalled();
    expect(sdk.cancel).not.toHaveBeenCalled();
    expect((await cycles.status())?.status).toBe("completed");
    await expect(cycles.reserveAgent({}, "retry")).rejects.toThrow("CYCLE_NOT_EXECUTABLE");
    expect(sdk.create).toHaveBeenCalledTimes(2);
  } finally {
    await cycles.detach();
    await rm(root, { recursive: true, force: true });
  }
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

it("preserves both genuine late successes after an explicitly approved unknown replacement without more SDK work", async () => {
  const root = await mkdtemp(join(tmpdir(), "exa-replace-sdk-"));
  const cycles = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "sdk-test" });
  try {
    const cycle = await cycles.start("question");
    await cycles.recordStep({
      topic: "question",
      stage: "source_retrieval",
      note: "Prepare",
      thought_number: 1,
      total_thoughts: 1,
      next_step_needed: false,
      executionPlan: {
        goal: "answer",
        taskSchema: {
          type: "object",
          required: ["answer"],
          properties: { answer: { type: "string" } },
          additionalProperties: false,
        },
      },
    });
    const artifact = await cycles.preview();
    if (typeof artifact.request.query !== "string") throw new Error("Compiled query missing");
    const request = { ...artifact.request, query: artifact.request.query };
    const hash = agentRequestHash(artifact.request);
    await cycles.grantBudget(cycle.id, 1, ["web_research_exa"]);
    await cycles.grantUncertainty(cycle.id, "request", hash, 0.2);
    let resolveOriginal!: (reply: {
      id: string;
      status: "completed";
      costDollars: { total: number };
      output: { structured: { answer: string } };
    }) => void;
    let observed!: () => void;
    const lateObservation = new Promise<void>((done) => {
      observed = done;
    });
    const signal = new AbortController();
    sdk.create
      .mockImplementationOnce(() => {
        signal.abort();
        return new Promise((done) => {
          resolveOriginal = done;
        });
      })
      .mockResolvedValueOnce({
        id: "agent_run_replacement",
        status: "completed",
        costDollars: { total: 0.1 },
        output: { structured: { answer: "replacement" } },
      });
    const first = (await cycles.reserveAgent()).attempt;
    const original = cycles.agentLifecycleObserver(cycle.id, first.id, hash);
    await expect(
      performResearch("offline", request, {
        signal: signal.signal,
        observer: {
          beforeCreate: original.beforeCreate,
          raw: async (phase, reply) => {
            await original.raw(phase, reply);
            observed();
          },
        },
      }),
    ).rejects.toThrow("Cancelled.");
    await original.finish();
    expect((await cycles.status())?.status).toBe("unknown");
    await cycles.grantUncertainty(cycle.id, "request", hash, 0.2);
    await expect(cycles.reserveAgent({}, "replace")).rejects.toThrow("REPLACEMENT_APPROVAL_REQUIRED");
    expect(sdk.create).toHaveBeenCalledTimes(1);
    await cycles.grantReplacement(cycle.id, first.id, hash, 0.2);
    const second = (await cycles.reserveAgent({}, "replace")).attempt;
    const replacement = cycles.agentLifecycleObserver(cycle.id, second.id, hash);
    await performResearch("offline", request, { observer: replacement });
    await replacement.finish();
    resolveOriginal({
      id: "agent_run_original_late",
      status: "completed",
      costDollars: { total: 0.1 },
      output: { structured: { answer: "original also succeeded" } },
    });
    await lateObservation;
    const saved = await cycles.status();
    expect(saved?.status).toBe("completed");
    expect(saved?.attempts).toMatchObject([
      {
        result: {
          remoteId: "agent_run_original_late",
          remoteStatus: "completed",
          taskOutput: { answer: "original also succeeded" },
        },
      },
      {
        result: {
          remoteId: "agent_run_replacement",
          remoteStatus: "completed",
          taskOutput: { answer: "replacement" },
        },
      },
    ]);
    await expect(cycles.reserveAgent({}, "replace")).rejects.toThrow("CYCLE_NOT_EXECUTABLE");
    expect(sdk.create).toHaveBeenCalledTimes(2);
    expect(sdk.get).not.toHaveBeenCalled();
    expect(sdk.cancel).not.toHaveBeenCalled();
  } finally {
    await cycles.detach();
    await rm(root, { recursive: true, force: true });
  }
});

it("snapshots inspection metadata before an asynchronous host observer can mutate the SDK reply", async () => {
  sdk.get.mockResolvedValue({ id: "agent_run_existing", status: "running" });
  const response = await inspectResearchRun("offline", "agent_run_existing", {
    observer: {
      beforeGet: async () => () => {},
      raw: async (_phase, run) => {
        await Promise.resolve();
        run.status = "completed";
      },
    },
  });
  expect(response.details).toMatchObject({ remoteStatus: "running" });
  expect(sdk.get).toHaveBeenCalledTimes(1);
  expect(sdk.create).not.toHaveBeenCalled();
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

it.each([".", ".."])("rejects dot-segment ID %s before any SDK GET or host capability preparation", async (runId) => {
  const beforeGet = vi.fn(async () => () => {});
  await expect(
    inspectResearchRun("offline", runId, {
      observer: { beforeGet, raw: async () => {} },
    }),
  ).rejects.toThrow("Invalid Agent run ID.");
  expect(beforeGet).not.toHaveBeenCalled();
  expect(sdk.get).not.toHaveBeenCalled();
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
