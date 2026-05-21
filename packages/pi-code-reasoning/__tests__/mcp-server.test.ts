import { createMcpServer } from "@feniix/bridgekit/mcp";
import { describe, expect, it } from "vitest";
import { createMcpServerOptions } from "../extensions/mcp-server.js";

const toolNames = (options: ReturnType<typeof createMcpServerOptions>) => options.tools.map((tool) => tool.name);

describe("code reasoning MCP server", () => {
  it("exposes the portable tools through BridgeKit MCP options", () => {
    const options = createMcpServerOptions();

    expect(options.name).toBe("pi-code-reasoning");
    expect(options.version).toBe("3.0.1");
    expect(toolNames(options)).toEqual(["code_reasoning", "code_reasoning_status", "code_reasoning_reset"]);
    expect(options.instructions).toContain("sequential thinking");
  });

  it("can create a BridgeKit MCP server", () => {
    const server = createMcpServer(createMcpServerOptions());

    expect(server).toBeDefined();
  });
});
