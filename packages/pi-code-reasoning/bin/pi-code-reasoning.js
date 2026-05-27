#!/usr/bin/env node
import { runBinWrapper } from "@feniix/bridgekit/bin-wrapper";

await runBinWrapper({
  metaUrl: import.meta.url,
  mcpEntry: "dist/extensions/mcp-server.js",
  buildScript: "build:mcp",
  logPrefix: "pi-code-reasoning",
  // Route the build subprocess's stdout to /dev/null so any output (npm
  // warnings, postinstall scripts, etc.) cannot contaminate the parent
  // process's MCP JSON-RPC framing on stdout. stderr stays inherited so
  // build diagnostics remain visible.
  buildStdio: ["ignore", "inherit", "inherit"],
});
