import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

function createWrapperFixture(buildScript: string): string {
  const fixture = mkdtempSync(join(tmpdir(), "pi-code-reasoning-bin-"));
  mkdirSync(join(fixture, "bin"), { recursive: true });
  cpSync(join(packageRoot, "bin", "pi-code-reasoning.js"), join(fixture, "bin", "pi-code-reasoning.js"));
  writeFileSync(
    join(fixture, "package.json"),
    JSON.stringify({ type: "module", scripts: { "build:mcp": buildScript } }),
    "utf-8",
  );
  return fixture;
}

function writeFixtureServer(fixture: string): void {
  const serverDir = join(fixture, "dist", "extensions");
  mkdirSync(serverDir, { recursive: true });
  writeFileSync(
    join(serverDir, "mcp-server.js"),
    'import { writeFileSync } from "node:fs";\nexport async function runServer() { writeFileSync("server-ran", "yes"); }\n',
    "utf-8",
  );
}

function runFixtureWrapper(fixture: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [join(fixture, "bin", "pi-code-reasoning.js")], {
    cwd: fixture,
    encoding: "utf-8",
  });
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

    const binEntrypoint = readFileSync(join(packageRoot, "bin", "pi-code-reasoning.js"), "utf-8");
    expect(binEntrypoint).toContain("dist");
    expect(binEntrypoint).toContain("build:mcp");
    expect(binEntrypoint).toContain("runServer");

    const toolsDeclaration = readFileSync(join(packageRoot, "dist", "extensions", "tools.d.ts"), "utf-8");
    expect(toolsDeclaration).toContain("PortableTool<typeof codeReasoningParams>");
    expect(toolsDeclaration).not.toContain("PortableTool<TObject<{}>");
  }, 30_000);

  it("runs the wrapper against an existing package-local MCP build", () => {
    const fixture = createWrapperFixture("node missing-build-script.js");
    try {
      writeFixtureServer(fixture);

      const run = runFixtureWrapper(fixture);

      expect(run.status, String(run.stderr)).toBe(0);
      expect(readFileSync(join(fixture, "server-ran"), "utf-8")).toBe("yes");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("builds missing package-local MCP output before running the wrapper", () => {
    const fixture = createWrapperFixture("node build.mjs");
    try {
      writeFileSync(
        join(fixture, "build.mjs"),
        `import { writeFileSync } from "node:fs";\nimport { dirname } from "node:path";\nimport { fileURLToPath } from "node:url";\nimport { mkdirSync } from "node:fs";\nconst root = dirname(fileURLToPath(import.meta.url));\nmkdirSync(new URL("./dist/extensions/", import.meta.url), { recursive: true });\nwriteFileSync(new URL("./dist/extensions/mcp-server.js", import.meta.url), 'import { writeFileSync } from "node:fs";\\nexport async function runServer() { writeFileSync("server-ran", "yes"); }\\n');\nwriteFileSync(new URL("./build-ran", import.meta.url), "yes");\nvoid root;\n`,
        "utf-8",
      );

      const run = runFixtureWrapper(fixture);

      expect(run.status, String(run.stderr)).toBe(0);
      expect(readFileSync(join(fixture, "build-ran"), "utf-8")).toBe("yes");
      expect(readFileSync(join(fixture, "server-ran"), "utf-8")).toBe("yes");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("fails the wrapper when the fallback build does not produce an MCP server", () => {
    const fixture = createWrapperFixture("node build.mjs");
    try {
      writeFileSync(
        join(fixture, "build.mjs"),
        'import { writeFileSync } from "node:fs";\nwriteFileSync("build-ran", "yes");\n',
        "utf-8",
      );

      const run = runFixtureWrapper(fixture);

      expect(run.status).toBe(1);
      expect(run.stderr).toContain("Failed to build the local MCP server");
      expect(readFileSync(join(fixture, "build-ran"), "utf-8")).toBe("yes");
      expect(existsSync(join(fixture, "server-ran"))).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("preserves the fallback build exit code on wrapper failure", () => {
    const fixture = createWrapperFixture("node build.mjs");
    try {
      writeFileSync(join(fixture, "build.mjs"), "process.exit(7);\n", "utf-8");

      const run = runFixtureWrapper(fixture);

      expect(run.status).toBe(7);
      expect(run.stderr).toContain("Failed to build the local MCP server");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
