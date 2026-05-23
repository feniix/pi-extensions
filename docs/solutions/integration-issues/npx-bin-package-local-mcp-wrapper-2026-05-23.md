---
title: Npx Bin Uses Package-Local MCP Wrapper
date: 2026-05-23
category: integration-issues
module: pi-code-reasoning
problem_type: integration_issue
component: tooling
symptoms:
  - "npx @feniix/pi-code-reasoning could fail when the compiled MCP server was missing or not resolved package-locally"
  - "package bin pointed directly at dist/extensions/mcp-server.js instead of a stable wrapper"
  - "workspace execution needed package-local build fallback behavior"
root_cause: config_error
resolution_type: code_fix
severity: medium
related_components:
  - "npm package bin entrypoint"
  - "MCP server build output"
  - "workspace packaging"
tags:
  - "pi-code-reasoning"
  - "npx"
  - "npm-bin"
  - "mcp"
  - "package-entrypoint"
  - "workspace"
---

# Npx Bin Uses Package-Local MCP Wrapper

## Problem

`@feniix/pi-code-reasoning` exposed the `pi-code-reasoning` binary by pointing npm `bin` directly at the compiled MCP server under `dist/`. Published packages should include `dist/`, but direct `bin` mappings still made `npx @feniix/pi-code-reasoning` and workspace-local execution fragile whenever generated build output was missing, stale, or not resolved relative to the package being executed.

## Symptoms

- `npx @feniix/pi-code-reasoning`/binary execution depended on `packages/pi-code-reasoning/dist/extensions/mcp-server.js` already existing.
- The package metadata pointed `bin.pi-code-reasoning` at generated output instead of a stable source-controlled executable.
- Local workspace usage needed a package-local fallback build rather than relying on checked-in `dist/` artifacts.
- The repository later needed `*/*/dist/` in `.gitignore` so package build output would not be accidentally committed or treated as source.

## What Didn't Work

- **Pointing `bin` directly at `dist/extensions/mcp-server.js`**: this only works after the MCP build has already run and assumes the generated file is executable and available in the package install.
- **Relying on generated `dist/` output as if it were source**: local package execution can happen before generated files exist, and committed build output can mask missing-build problems during tests.
- **Only checking package metadata**: metadata assertions caught the intended `bin` path, but fixture-based execution tests were needed to prove the wrapper works with existing output, missing output, and failed builds.
- **Making the `npx` command direct without changing the runtime shape**: commit `0d5e27b` renamed the binary from `pi-code-reasoning-mcp` to `pi-code-reasoning` so `npx -y @feniix/pi-code-reasoning` could work, and commit `81795ff` improved compiled entrypoints and package contents. Both still left `bin` pointing at `dist/extensions/mcp-server.js`, so they did not solve the missing local build-output failure mode.

## Solution

Use a small checked-in wrapper as the npm binary, include `bin/` in package files, and let the wrapper resolve/build the package-local MCP server before importing it.

Before, `packages/pi-code-reasoning/package.json` pointed directly at generated output:

```json
"bin": {
  "pi-code-reasoning": "./dist/extensions/mcp-server.js"
}
```

After, the package publishes a stable wrapper:

```json
"files": [
  "bin/",
  "extensions/",
  "dist/",
  "README.md",
  "LICENSE"
],
"bin": {
  "pi-code-reasoning": "./bin/pi-code-reasoning.js"
}
```

The wrapper in `packages/pi-code-reasoning/bin/pi-code-reasoning.js` resolves the server relative to the installed package, builds missing output for local/workspace execution, then imports and runs the generated MCP server:

```js
#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = join(packageRoot, "dist", "extensions", "mcp-server.js");

if (!existsSync(serverPath)) {
  const build = spawnSync("npm", ["run", "build:mcp", "--silent"], {
    cwd: packageRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    timeout: 60_000,
  });

  if (build.status !== 0 || !existsSync(serverPath)) {
    console.error(
      "[pi-code-reasoning] Failed to build the local MCP server. Run `npm run build:mcp --workspace packages/pi-code-reasoning` and try again.",
    );
    process.exit(build.status && build.status !== 0 ? build.status : 1);
  }
}

const { runServer } = await import(pathToFileURL(serverPath).href);
await runServer();
```

`packages/pi-code-reasoning/__tests__/package.test.ts` now verifies the packaging behavior end to end:

- package metadata points `bin` to `./bin/pi-code-reasoning.js`
- `npm pack --dry-run --json --workspace packages/pi-code-reasoning` includes executable wrapper and MCP output
- the wrapper runs an existing package-local MCP build
- the wrapper builds missing MCP output before running
- the wrapper fails clearly when the fallback build does not produce the MCP server
- the wrapper preserves non-zero fallback build exit codes

The follow-up `.gitignore` rule keeps generated package build output out of source control:

```gitignore
*/*/dist/
```

## Why This Works

The root cause was a package configuration mismatch: npm `bin` expected a generated `dist` artifact to behave like a stable entrypoint. A checked-in wrapper gives npm a durable executable while still keeping the actual MCP server in generated output.

Resolving `dist/extensions/mcp-server.js` from `import.meta.url` makes the wrapper package-local, so it does not depend on the caller's current working directory. The fallback `npm run build:mcp --silent` handles local and workspace development where `dist/` has not been created yet; published package installs should normally receive `dist/` from `prepack`. The post-build existence check catches build scripts that exit successfully but fail to produce the server file, and preserving non-zero build statuses keeps CI and users from seeing a misleading generic failure.

## Prevention

- Put npm `bin` entries on stable, checked-in wrapper scripts when the real runtime target is generated.
- Resolve generated runtime files relative to the package root, not the caller's working directory.
- Test wrapper behavior for existing output, missing output, failed builds, and successful builds that omit the expected artifact.
- Keep `npm pack --dry-run --json` assertions for package contents and executable modes.
- Ignore generated package `dist/` directories so tests do not silently depend on committed build artifacts.

## Related Issues

- PR: [#102 fix(pi-code-reasoning): make npx bin work from workspace](https://github.com/feniix/pi-extensions/pull/102)
- Earlier context:
  - `098a2c5` documented MCP `npx` usage with an explicit `--package @feniix/pi-code-reasoning pi-code-reasoning-mcp` invocation.
  - `0d5e27b` made the command direct by renaming the bin to `pi-code-reasoning`, but still targeted generated `dist/` output directly.
  - `81795ff` published compiled package entrypoints and added `npm pack --dry-run` coverage, but still left the final bin-wrapper gap.
- Related implementation files:
  - `packages/pi-code-reasoning/package.json`
  - `packages/pi-code-reasoning/bin/pi-code-reasoning.js`
  - `packages/pi-code-reasoning/__tests__/package.test.ts`
  - `.gitignore`
