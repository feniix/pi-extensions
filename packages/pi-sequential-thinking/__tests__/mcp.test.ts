import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpServer } from "@feniix/bridgekit/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThoughtAnalyzer } from "../extensions/analyzer.js";
import { createMcpServerOptions } from "../extensions/mcp-server.js";
import { ThoughtStorage } from "../extensions/storage.js";
import type { SequentialThinkingDeps } from "../extensions/tools.js";

let storageDir: string;
let deps: SequentialThinkingDeps;

beforeEach(() => {
  storageDir = mkdtempSync(join(tmpdir(), "pi-seq-think-mcp-"));
  deps = {
    storage: new ThoughtStorage(storageDir),
    analyzer: new ThoughtAnalyzer(),
    effectiveConfigForStatus: {
      storageDir,
      maxBytes: 51200,
      maxLines: 2000,
      sources: { storageDir: "default", maxBytes: "default", maxLines: "default" },
    },
  };
});

afterEach(() => {
  rmSync(storageDir, { recursive: true, force: true });
});

async function connectInMemoryClient() {
  const server = createMcpServer(createMcpServerOptions({ deps, version: "0.0.0-test" }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "pi-seq-think-test-client", version: "0.0.0" }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

describe("pi-sequential-thinking MCP server", () => {
  it("advertises the eight sequential-thinking tools via tools/list", async () => {
    const { client, close } = await connectInMemoryClient();
    try {
      const response = await client.listTools();
      const names = response.tools.map((tool) => tool.name);
      expect(names).toEqual([
        "process_thought",
        "generate_summary",
        "clear_history",
        "export_session",
        "import_session",
        "get_thinking_history",
        "get_thinking_status",
        "sequential_think",
      ]);
    } finally {
      await close();
    }
  });

  it("includes a JSON Schema inputSchema with title and description for each tool", async () => {
    const { client, close } = await connectInMemoryClient();
    try {
      const response = await client.listTools();
      for (const tool of response.tools) {
        expect(tool.title).toBeDefined();
        expect(tool.description?.length ?? 0).toBeGreaterThan(0);
        expect(tool.inputSchema).toMatchObject({ type: "object" });
      }
    } finally {
      await close();
    }
  });

  it("calls process_thought and returns structuredContent + persists state", async () => {
    const { client, close } = await connectInMemoryClient();
    try {
      const result = await client.callTool({
        name: "process_thought",
        arguments: {
          thought: "First MCP thought",
          thought_number: 1,
          total_thoughts: 1,
          next_thought_needed: false,
          stage: "Problem Definition",
        },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        thoughtAnalysis: { currentThought: expect.objectContaining({ thoughtNumber: 1 }) },
        receipt: expect.objectContaining({ operation: "process_thought", postCount: 1 }),
      });
      expect(deps.storage.getAllThoughts(null)).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it("surfaces domain validation errors as isError CallToolResults", async () => {
    const { client, close } = await connectInMemoryClient();
    try {
      const result = await client.callTool({
        name: "process_thought",
        arguments: { thought: "x", stage: "Problem Definition" },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        tool: "process_thought",
        validationErrors: expect.arrayContaining([expect.objectContaining({ field: "thought_number" })]),
      });
    } finally {
      await close();
    }
  });

  it("surfaces TypeBox schema rejections as isError CallToolResults", async () => {
    const { client, close } = await connectInMemoryClient();
    try {
      const result = await client.callTool({
        name: "sequential_think",
        arguments: { topic: "x", num_thoughts: 99 },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        kind: "validation",
        tool: "sequential_think",
      });
      expect(deps.storage.getAllThoughts(null)).toHaveLength(0);
    } finally {
      await close();
    }
  });
});
