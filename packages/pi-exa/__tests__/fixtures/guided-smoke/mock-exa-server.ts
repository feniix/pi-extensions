/**
 * Controllable mock of the Exa Agent run HTTP endpoints for the #175 smoke.
 *
 * The real `exa-js` SDK in a real `pi` process talks to this server through
 * `EXA_BASE_URL`. Runs stay `running` until the test flips them; GET failures
 * can be injected per run. No other Exa endpoint is served.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface MockRun {
  id: string;
  object: "agent.run";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  createdAt: string;
  completedAt?: string;
  stopReason?: string;
  output?: { structured?: unknown; grounding?: unknown[] };
  usage?: Record<string, number>;
  costDollars?: { total: number };
  error?: { message: string; code?: string };
}

export interface RecordedRequest {
  method: string;
  path: string;
  apiKey: string | undefined;
  body?: unknown;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

export async function startMockExaServer() {
  const runs = new Map<string, MockRun>();
  const requests: RecordedRequest[] = [];
  const failNextGets = new Map<string, number[]>();
  let created = 0;
  const json = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://mock");
    const text = await readBody(request);
    const body = text ? (JSON.parse(text) as unknown) : undefined;
    const apiKey = request.headers["x-api-key"];
    requests.push({
      method: request.method ?? "",
      path: url.pathname,
      apiKey: Array.isArray(apiKey) ? apiKey[0] : apiKey,
      ...(body === undefined ? {} : { body }),
    });
    if (request.method === "POST" && url.pathname === "/agent/runs") {
      created += 1;
      const run: MockRun = {
        id: `smoke_run_${created}`,
        object: "agent.run",
        status: "running",
        createdAt: new Date().toISOString(),
      };
      runs.set(run.id, run);
      json(response, 200, run);
      return;
    }
    const match = /^\/agent\/runs\/([^/]+)$/.exec(url.pathname);
    if (request.method === "GET" && match) {
      const id = decodeURIComponent(match[1]);
      const queued = failNextGets.get(id);
      const statusCode = queued?.shift();
      if (statusCode !== undefined) {
        json(response, statusCode, { statusCode, message: `mock failure ${statusCode}`, path: url.pathname });
        return;
      }
      const run = runs.get(id);
      if (!run) {
        json(response, 404, { statusCode: 404, message: "Run not found", path: url.pathname, type: "NOT_FOUND" });
        return;
      }
      json(response, 200, run);
      return;
    }
    // Cancellation and everything else is unexpected in the guided flow.
    json(response, 405, {
      statusCode: 405,
      message: `Unexpected ${request.method} ${url.pathname}`,
      path: url.pathname,
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    runs,
    complete(id: string, structured: unknown = { summary: "Laya is cheaper per decision; Jev calibrates better." }) {
      const run = runs.get(id);
      if (!run) throw new Error(`Unknown mock run ${id}`);
      run.status = "completed";
      run.stopReason = "schema_satisfied";
      run.completedAt = new Date().toISOString();
      run.output = { structured, grounding: [] };
      run.usage = { searches: 3 };
      run.costDollars = { total: 0.1 };
    },
    fail(id: string) {
      const run = runs.get(id);
      if (!run) throw new Error(`Unknown mock run ${id}`);
      run.status = "failed";
      run.stopReason = "error";
      run.error = { message: "mock remote failure", code: "INTERNAL_ERROR" };
    },
    failNextGets(id: string, statusCodes: number[]) {
      failNextGets.set(id, [...(failNextGets.get(id) ?? []), ...statusCodes]);
    },
    counts() {
      return {
        creates: requests.filter((entry) => entry.method === "POST" && entry.path === "/agent/runs").length,
        gets: requests.filter((entry) => entry.method === "GET").length,
        other: requests.filter(
          (entry) => !(entry.method === "GET" || (entry.method === "POST" && entry.path === "/agent/runs")),
        ).length,
      };
    },
    async close() {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

export type MockExaServer = Awaited<ReturnType<typeof startMockExaServer>>;
