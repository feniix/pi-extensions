import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpServer } from "@feniix/bridgekit/mcp";
import { describe, expect, it, vi } from "vitest";
import { createMcpServerOptions, runServer } from "../extensions/mcp-server.js";

const toolNames = (options: ReturnType<typeof createMcpServerOptions>) => options.tools.map((tool) => tool.name);
const packageJson = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf-8"),
) as { version: string };

describe("code reasoning MCP server", () => {
  it("exposes the portable tools through BridgeKit MCP options", () => {
    const options = createMcpServerOptions();

    expect(options.name).toBe("pi-code-reasoning");
    expect(options.version).toBe(packageJson.version);
    expect(toolNames(options)).toEqual(["code_reasoning", "code_reasoning_status", "code_reasoning_reset"]);
    expect(options.instructions).toContain("sequential thinking");
  });

  it("can create a BridgeKit MCP server", () => {
    const server = createMcpServer(createMcpServerOptions());

    expect(server).toBeDefined();
  });

  it("starts stdio with the MCP options", async () => {
    const runMcpStdioServer = vi.fn().mockResolvedValue(undefined);

    await runServer(runMcpStdioServer);

    expect(runMcpStdioServer).toHaveBeenCalledWith(expect.objectContaining({ name: "pi-code-reasoning" }));
  });
});
