import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(packageRoot, "..", "..");

const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8")) as {
  bin: Record<string, string>;
  exports: Record<string, string | { types: string; import: string }>;
  files: string[];
  pi: { extensions: string[] };
  scripts: Record<string, string>;
};

function cleanDist(): void {
  rmSync(join(packageRoot, "dist"), { recursive: true, force: true });
}

afterEach(() => {
  cleanDist();
});

describe("pi-code-reasoning package metadata", () => {
  it("keeps the pi source extension available while publishing compiled Node entrypoints", () => {
    expect(packageJson.pi.extensions).toEqual(["./extensions/index.ts"]);
    expect(Object.hasOwn(packageJson.exports, ".")).toBe(false);
    expect(packageJson.exports).toMatchObject({
      "./mcp": {
        types: "./dist/extensions/mcp-server.d.ts",
        import: "./dist/extensions/mcp-server.js",
      },
      "./tools": {
        types: "./dist/extensions/tools.d.ts",
        import: "./dist/extensions/tools.js",
      },
      "./extensions/*.js": {
        types: "./dist/extensions/*.d.ts",
        import: "./dist/extensions/*.js",
      },
      "./extensions/*": {
        types: "./dist/extensions/*.d.ts",
        import: "./dist/extensions/*.js",
      },
    });
  });

  it("publishes an npx-friendly MCP binary backed by the package-local build", () => {
    expect(packageJson.bin).toEqual({
      "pi-code-reasoning": "./bin/pi-code-reasoning.js",
    });
    expect(packageJson.files).toContain("bin/");
    expect(packageJson.files).toContain("dist/");
    expect(packageJson.scripts["build:mcp"]).toContain("tsconfig.mcp.json");
    expect(packageJson.scripts["build:mcp"]).toContain("chmodSync");
    expect(packageJson.scripts.prepack).toBe("npm run build:mcp");
  });

  it("packs executable MCP output and concrete portable tool declarations", () => {
    cleanDist();
    const pack = spawnSync(
      "npm",
      ["pack", "--dry-run", "--json", "--workspace", "packages/pi-code-reasoning", "--silent"],
      {
        cwd: repoRoot,
        encoding: "utf-8",
      },
    );

    expect(pack.status, pack.stderr).toBe(0);
    const [packResult] = JSON.parse(pack.stdout) as [{ files: Array<{ path: string; mode: number }> }];
    const filesByPath = new Map(packResult.files.map((file) => [file.path, file]));

    expect(filesByPath.get("bin/pi-code-reasoning.js")?.mode).toBe(493);
    expect(filesByPath.get("dist/extensions/mcp-server.js")?.mode).toBe(493);
    expect(filesByPath.has("dist/extensions/index.js")).toBe(true);
    expect(filesByPath.has("dist/extensions/tools.d.ts")).toBe(true);

    // bin entrypoint delegates to @feniix/bridgekit/bin-wrapper since the
    // 0.11.0 adoption commit; the four behavioral scenarios (entry present,
    // entry built on demand, build fails, build exit code preserved) live
    // in bridgekit's own test suite. Here we only pin that the consumer
    // invokes the helper with the correct trusted-literal options.
    const binEntrypoint = readFileSync(join(packageRoot, "bin", "pi-code-reasoning.js"), "utf-8");
    expect(binEntrypoint).toContain("@feniix/bridgekit/bin-wrapper");
    expect(binEntrypoint).toContain("runBinWrapper");
    expect(binEntrypoint).toContain('mcpEntry: "dist/extensions/mcp-server.js"');
    expect(binEntrypoint).toContain('buildScript: "build:mcp"');

    const toolsDeclaration = readFileSync(join(packageRoot, "dist", "extensions", "tools.d.ts"), "utf-8");
    expect(toolsDeclaration).toContain("PortableTool<typeof codeReasoningParams>");
    expect(toolsDeclaration).not.toContain("PortableTool<TObject<{}>");
  }, 30_000);
});
