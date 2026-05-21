import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf-8"),
) as {
  exports: Record<string, string>;
};

describe("pi-code-reasoning package metadata", () => {
  it("keeps extension deep imports available while adding MCP-friendly entrypoints", () => {
    expect(packageJson.exports).toMatchObject({
      ".": "./extensions/index.ts",
      "./mcp": "./extensions/mcp-server.ts",
      "./tools": "./extensions/tools.ts",
      "./extensions/*": "./extensions/*",
    });
  });
});
