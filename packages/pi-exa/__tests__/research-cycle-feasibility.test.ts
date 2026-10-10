/**
 * Offline SDK contract checks for #152, not an implementation of research cycles.
 * All HTTP is intercepted; no API credentials or live research are used.
 */
import { Exa } from "exa-js";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  compiledArtifact,
  completedRun,
  failedRun,
  processingRequest,
  remoteRequest,
} from "./fixtures/research-cycle.js";

// exa-js captures fetch at module load, so intercept before importing the SDK.
const { fetch, originalFetch } = vi.hoisted(() => {
  const originalFetch = globalThis.fetch;
  const fetch = vi.fn<(url: unknown, init?: RequestInit) => Promise<Response>>();
  globalThis.fetch = fetch;
  return { fetch, originalFetch };
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

function transport(response: unknown) {
  fetch.mockReset();
  fetch.mockResolvedValue(Response.json(response));
  return { fetch, exa: new Exa("offline-fixture-key", "https://offline.invalid") };
}

describe("research cycle feasibility against the installed Exa SDK", () => {
  it("sends the compiled remote request without local artifact or source-pack fields", async () => {
    const { fetch, exa } = transport(completedRun);
    const run = await exa.agent.runs.create(remoteRequest);

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://offline.invalid/agent/runs");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(remoteRequest);
    expect(new Headers(init?.headers).has("Idempotency-Key")).toBe(false);
    expect(new Headers(init?.headers).has("Exa-Beta")).toBe(false);
    expect(remoteRequest).not.toHaveProperty("input");
    expect(remoteRequest).not.toHaveProperty("sourcePack");
    expect(remoteRequest.query).toContain(compiledArtifact.selectedEvidence[0].url);
    expect(run.output?.structured).toEqual(completedRun.output?.structured);
    expect(run.output?.grounding).toEqual(completedRun.output?.grounding);
  });

  it("keeps explicit processing/exclusion rows distinct from evidence context", async () => {
    const { fetch, exa } = transport(completedRun);
    await exa.agent.runs.create(processingRequest);

    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual(processingRequest);
    expect(processingRequest.input?.data).toEqual([{ domain: "example.com" }]);
    expect(processingRequest.input?.exclusion).toEqual([{ domain: "excluded.example" }]);
  });

  it("uses GET for existing-run recovery and preserves cost-bearing failure data", async () => {
    const { fetch, exa } = transport(failedRun);
    const run = await exa.agent.runs.get(failedRun.id);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe(`https://offline.invalid/agent/runs/${failedRun.id}`);
    expect(fetch.mock.calls[0][1]?.method).toBe("GET");
    expect(run).toEqual(failedRun);
  });

  it("can receive a completed run from cancellation without losing its output or accounting", async () => {
    const { fetch, exa } = transport(completedRun);
    const run = await exa.agent.runs.cancel(completedRun.id);

    expect(fetch.mock.calls[0][0]).toBe(`https://offline.invalid/agent/runs/${completedRun.id}/cancel`);
    expect(fetch.mock.calls[0][1]?.method).toBe("POST");
    expect(run).toEqual(completedRun);
  });

  it("submits continuation as another POST rather than recovering with GET", async () => {
    const { fetch, exa } = transport({ ...completedRun, id: "fixture-continuation" });
    const run = await exa.agent.runs.create({ ...remoteRequest, previousRunId: completedRun.id });

    expect(fetch.mock.calls[0][1]?.method).toBe("POST");
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toHaveProperty("previousRunId", completedRun.id);
    expect(run.id).toBe("fixture-continuation");
  });

  it("preserves empty retrieval response estimates at the SDK seam", async () => {
    const response = { requestId: "fixture-empty", results: [], costDollars: { total: 0.007 } };
    const { exa } = transport(response);

    expect(await exa.search("fixture", { type: "auto", numResults: 5 })).toEqual(response);
  });
});
