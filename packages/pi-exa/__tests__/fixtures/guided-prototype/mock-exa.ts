/**
 * Controllable mock of the Exa Agent run endpoints used by the #171 prototype.
 *
 * It never performs network I/O. Tests and the interactive `/exa-proto` command
 * flip runs between states and inject GET failures so the host-owned monitor can
 * be observed against pending, transient-error, auth, not-found and terminal paths.
 */

export type MockRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface MockRun {
  id: string;
  status: MockRunStatus;
  stopReason?: "schema_satisfied" | "budget_reached" | "time_limit_reached" | "stopped" | "error" | "cancelled";
  output?: { content?: unknown; structured?: unknown };
  usage?: Record<string, number>;
  costDollars?: { total: number };
  error?: { message: string };
  request?: Record<string, unknown>;
}

/** Mirrors the shape the pinned exa-js `ExaError` exposes; no retry guidance is available. */
export class MockExaError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "MockExaError";
  }
}

export interface MockExaOptions {
  /** Hold every create until `releaseCreate()` is called. */
  holdCreate?: boolean;
}

export function createMockExa(options: MockExaOptions = {}) {
  const runs = new Map<string, MockRun>();
  const counters = { create: 0, get: 0, cancel: 0 };
  const queuedGetErrors = new Map<string, number[]>();
  const heldCreates: Array<() => void> = [];
  let holdCreate = options.holdCreate ?? false;
  const rejectedCreates: number[] = [];

  const nextRun = (request: Record<string, unknown>): MockRun => {
    const run: MockRun = { id: `run_${counters.create}`, status: "running", request };
    runs.set(run.id, run);
    return run;
  };

  return {
    counters,
    runs,
    /** One create per approved submission. Resolves immediately unless creates are held. */
    create(request: Record<string, unknown>): Promise<MockRun> {
      counters.create += 1;
      const rejection = rejectedCreates.shift();
      if (rejection !== undefined)
        return Promise.reject(new MockExaError(`mock create rejected ${rejection}`, rejection));
      if (!holdCreate) return Promise.resolve(nextRun(request));
      return new Promise<MockRun>((resolve) => {
        heldCreates.push(() => resolve(nextRun(request)));
      });
    },
    /** Make the next create fail definitively with an HTTP-like status before any run exists. */
    rejectNextCreate(statusCode: number): void {
      rejectedCreates.push(statusCode);
    },
    /** Release every held create, delivering a genuine late acknowledgement. */
    releaseCreate(): void {
      holdCreate = false;
      for (const release of heldCreates.splice(0)) release();
    },
    get(runId: string): Promise<MockRun> {
      counters.get += 1;
      const errors = queuedGetErrors.get(runId);
      const statusCode = errors?.shift();
      if (statusCode !== undefined)
        return Promise.reject(new MockExaError(`mock GET failure ${statusCode}`, statusCode));
      const run = runs.get(runId);
      if (!run) return Promise.reject(new MockExaError(`Run ${runId} not found`, 404));
      return Promise.resolve(structuredClone(run));
    },
    /** Remote cancellation is never expected from the guided flow; count and refuse it. */
    cancel(runId: string): Promise<MockRun> {
      counters.cancel += 1;
      return Promise.reject(new Error(`Unexpected cancel for ${runId}`));
    },
    complete(runId: string, output: unknown = { summary: "mock findings" }, costDollars = 0.1): MockRun {
      const run = runs.get(runId);
      if (!run) throw new Error(`Unknown mock run ${runId}`);
      run.status = "completed";
      run.stopReason = "schema_satisfied";
      run.output = { structured: output };
      run.usage = { steps: 3 };
      run.costDollars = { total: costDollars };
      return run;
    },
    fail(runId: string, message = "mock remote failure"): MockRun {
      const run = runs.get(runId);
      if (!run) throw new Error(`Unknown mock run ${runId}`);
      run.status = "failed";
      run.stopReason = "error";
      run.error = { message };
      return run;
    },
    /** Queue HTTP-like failures for the next GETs of a run, in order. */
    failNextGets(runId: string, statusCodes: number[]): void {
      queuedGetErrors.set(runId, [...(queuedGetErrors.get(runId) ?? []), ...statusCodes]);
    },
    /** Forget a run so later GETs return 404 without the run ever having failed remotely. */
    lose(runId: string): void {
      runs.delete(runId);
    },
  };
}

export type MockExa = ReturnType<typeof createMockExa>;
