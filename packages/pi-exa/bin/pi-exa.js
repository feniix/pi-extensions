#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = join(packageRoot, "dist", "extensions", "mcp-server.js");

if (!existsSync(serverPath)) {
  // stdio: child stdout is routed to /dev/null so it cannot contaminate the
  // MCP host's JSON-RPC framing on this process's stdout. stderr is inherited
  // so build diagnostics remain visible.
  const build = spawnSync("npm", ["run", "build:mcp", "--silent"], {
    cwd: packageRoot,
    stdio: ["ignore", "inherit", "inherit"],
    shell: process.platform === "win32",
    timeout: 60_000,
  });

  if (build.status !== 0 || !existsSync(serverPath)) {
    if (build.status === null) {
      const diagnostic = build.error?.message ?? build.error?.code ?? "timed out or was killed";
      console.error(`[pi-exa] MCP build did not complete: ${diagnostic}`);
    }
    console.error(
      "[pi-exa] Failed to build the local MCP server. Run `npm run build:mcp --workspace packages/pi-exa` and try again.",
    );
    process.exit(typeof build.status === "number" && build.status !== 0 ? build.status : 1);
  }
}

const { runServer } = await import(pathToFileURL(serverPath).href);
await runServer();
