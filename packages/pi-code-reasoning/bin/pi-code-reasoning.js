#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = join(packageRoot, "dist", "extensions", "mcp-server.js");

if (!existsSync(serverPath)) {
  const build = spawnSync("npm", ["run", "build:mcp", "--silent"], {
    cwd: packageRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (build.status !== 0 || !existsSync(serverPath)) {
    console.error(
      "[pi-code-reasoning] Failed to build the local MCP server. Run `npm run build:mcp --workspace packages/pi-code-reasoning` and try again.",
    );
    process.exit(build.status ?? 1);
  }
}

const { runServer } = await import(pathToFileURL(serverPath).href);
await runServer();
