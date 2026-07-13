#!/usr/bin/env node
import { runBinWrapper } from "@feniix/bridgekit/bin-wrapper";

await runBinWrapper({
  metaUrl: import.meta.url,
  mcpEntry: "dist/extensions/mcp-server.js",
  buildScript: "build:mcp",
  logPrefix: "pi-agent-journal",
  buildStdio: ["ignore", "inherit", "inherit"],
});
