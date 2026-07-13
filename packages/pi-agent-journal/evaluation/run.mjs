#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createGitWorktreePreparer,
  createNodePhaseRunner,
  runEvaluationPair,
} from "../dist/extensions/evaluation-harness.js";

const configPath = process.argv[2];
if (!configPath) {
  process.stderr.write("Usage: npm run evaluate:v2 -- <private-config.json>\n");
  process.exitCode = 2;
} else {
  try {
    const config = JSON.parse(await readFile(resolve(configPath), "utf8"));
    if (
      typeof config.executable !== "string" ||
      typeof config.repositoryRoot !== "string" ||
      typeof config.spec !== "object" ||
      config.spec === null
    ) {
      throw new Error("config requires executable, repositoryRoot, and spec");
    }
    const repositoryRoot = resolve(config.repositoryRoot);
    const result = await runEvaluationPair(config.spec, {
      prepareWorkspace: createGitWorktreePreparer(repositoryRoot),
      runPhase: createNodePhaseRunner(resolve(config.executable)),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`Agent Journal V2 evaluation failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  }
}
