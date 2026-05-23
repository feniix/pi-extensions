import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf-8"),
) as {
  bin: Record<string, string>;
  exports: Record<string, string | { types: string; import: string }>;
  files: string[];
  scripts: Record<string, string>;
};

describe("pi-code-reasoning package metadata", () => {
  it("keeps the pi source extension available while publishing compiled MCP entrypoints", () => {
    expect(packageJson.exports).toMatchObject({
      ".": "./extensions/index.ts",
      "./mcp": {
        types: "./dist/extensions/mcp-server.d.ts",
        import: "./dist/extensions/mcp-server.js",
      },
      "./tools": {
        types: "./dist/extensions/tools.d.ts",
        import: "./dist/extensions/tools.js",
      },
      "./extensions/*": "./extensions/*",
    });
  });

  it("publishes an npx-friendly MCP binary backed by the package-local build", () => {
    expect(packageJson.bin).toEqual({
      "pi-code-reasoning": "./dist/extensions/mcp-server.js",
    });
    expect(packageJson.files).toContain("dist/");
    expect(packageJson.scripts["build:mcp"]).toContain("tsconfig.mcp.json");
    expect(packageJson.scripts.prepack).toBe("npm run build:mcp");
  });
});
