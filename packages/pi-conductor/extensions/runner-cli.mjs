#!/usr/bin/env node

import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && specifier.endsWith(".js") && context.parentURL) {
      const typeScriptUrl = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(typeScriptUrl))) {
        return { url: typeScriptUrl.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});

const runnerUrl = new URL("./runner.ts", import.meta.url);

try {
  const runner = await import(runnerUrl.href);
  await runner.main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
