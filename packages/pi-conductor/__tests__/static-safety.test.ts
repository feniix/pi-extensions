import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import conductorExtension from "../extensions/index.js";

function collectTools(): Array<{ name: string; parameters?: unknown }> {
  const tools: Array<{ name: string; parameters?: unknown }> = [];
  const fakePi = {
    registerCommand: () => undefined,
    registerTool: (tool: { name: string; parameters?: unknown }) => tools.push(tool),
  };
  conductorExtension(fakePi as never);
  return tools;
}

function collectWriteRunCallSites(paths: string[]): string[] {
  const sites: string[] = [];
  for (const path of paths) {
    const source = ts.createSourceFile(path, readFileSync(path, "utf-8"), ts.ScriptTarget.Latest, true);
    function topLevelFunctionName(node: ts.Node): string {
      let current: ts.Node | undefined = node;
      let name = "<top-level>";
      while (current) {
        if (ts.isFunctionDeclaration(current) && current.name && ts.isSourceFile(current.parent)) {
          name = current.name.text;
        }
        current = current.parent;
      }
      return name;
    }
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "writeRun") {
        sites.push(`${basename(path)}:${topLevelFunctionName(node)}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return sites.sort();
}

describe("pi-conductor static safety guards", () => {
  it("keeps the extension entrypoint thin and free of tool registration details", () => {
    const source = readFileSync(join(__dirname, "../extensions/index.ts"), "utf-8");
    expect(source.split("\n").length).toBeLessThan(180);
    expect(source).not.toContain("registerTool(");
    expect(source).toContain("registerConductorTools(");
  });

  it("keeps model tool registration split by control-plane domain", () => {
    const extensionDir = join(__dirname, "../extensions");
    const registrar = readFileSync(join(extensionDir, "tools.ts"), "utf-8");
    expect(registrar.split("\n").length).toBeLessThan(120);
    expect(registrar).not.toContain("pi.registerTool(");

    for (const file of [
      "tools/project-tools.ts",
      "tools/objective-tools.ts",
      "tools/task-tools.ts",
      "tools/gate-tools.ts",
      "tools/evidence-tools.ts",
      "tools/worker-tools.ts",
    ]) {
      expect(readFileSync(join(extensionDir, file), "utf-8").split("\n").length).toBeLessThan(420);
    }
  });

  it("keeps storage validation in a dedicated schema boundary", () => {
    const extensionDir = join(__dirname, "../extensions");
    const storageSource = readFileSync(join(extensionDir, "storage.ts"), "utf-8");
    const validationSource = readFileSync(join(extensionDir, "storage-validation.ts"), "utf-8");
    const normalizeSource = readFileSync(join(extensionDir, "storage-normalize.ts"), "utf-8");

    expect(storageSource.split("\n").length).toBeLessThan(1600);
    expect(storageSource).toContain('from "./storage-validation.js"');
    expect(storageSource).toContain('from "./storage-normalize.js"');
    expect(storageSource).not.toContain("conductorEventTypes");
    expect(validationSource.split("\n").length).toBeLessThan(420);
    expect(normalizeSource.split("\n").length).toBeLessThan(120);
  });

  it("keeps next-action recommendation planning in a pure conductor module", () => {
    const extensionDir = join(__dirname, "../extensions");
    const conductorSource = readFileSync(join(extensionDir, "conductor.ts"), "utf-8");
    const nextActionsSource = readFileSync(join(extensionDir, "next-actions.ts"), "utf-8");

    expect(conductorSource.split("\n").length).toBeLessThan(2300);
    expect(conductorSource).toContain('from "./next-actions.js"');
    expect(conductorSource).not.toContain("function sortNextActions");
    expect(conductorSource).not.toContain("export function computeNextActions");
    expect(nextActionsSource).toContain("export function computeNextActions");
    expect(nextActionsSource.split("\n").length).toBeLessThan(420);
  });

  it("keeps scheduler action selection separate from scheduler side effects", () => {
    const extensionDir = join(__dirname, "../extensions");
    const conductorSource = readFileSync(join(extensionDir, "conductor.ts"), "utf-8");
    const schedulerSource = readFileSync(join(extensionDir, "scheduler-selection.ts"), "utf-8");

    expect(conductorSource.split("\n").length).toBeLessThan(2200);
    expect(conductorSource).toContain('from "./scheduler-selection.js"');
    expect(conductorSource).not.toContain("function roundRobinActions");
    expect(conductorSource).not.toContain("function objectiveKeyForAction");
    expect(schedulerSource).toContain("export function selectSchedulerActions");
    expect(schedulerSource.split("\n").length).toBeLessThan(140);
  });

  it("keeps objective planning and status logic outside the conductor orchestrator", () => {
    const extensionDir = join(__dirname, "../extensions");
    const conductorSource = readFileSync(join(extensionDir, "conductor.ts"), "utf-8");
    const objectiveSource = readFileSync(join(extensionDir, "objective-service.ts"), "utf-8");
    const repoRunSource = readFileSync(join(extensionDir, "repo-run.ts"), "utf-8");

    expect(conductorSource).toContain('from "./objective-service.js"');
    expect(conductorSource).toContain('from "./repo-run.js"');
    expect(conductorSource).not.toContain("function validateObjectivePlanTasks");
    expect(conductorSource).not.toContain("export function createObjectiveForRepo");
    expect(objectiveSource).toContain("export function planObjectiveForRepo");
    expect(objectiveSource.split("\n").length).toBeLessThan(240);
    expect(repoRunSource.split("\n").length).toBeLessThan(80);
  });

  it("does not expose trusted-human gate approval as a model tool", () => {
    const tools = collectTools();
    const toolNames = tools.map((tool) => tool.name).sort();

    expect(toolNames).not.toContain("conductor_resolve_gate_as_human");
    expect(toolNames).not.toContain("conductor_human_approve_gate");

    const resolveGateTools = tools.filter((tool) => tool.name.includes("resolve_gate"));
    expect(resolveGateTools.map((tool) => tool.name).sort()).toEqual(["conductor_resolve_gate"]);

    const exposedParameterSchemas = JSON.stringify(tools.map((tool) => tool.parameters));
    expect(exposedParameterSchemas).not.toContain("humanId");
    expect(exposedParameterSchemas).not.toMatch(/"const"\s*:\s*"human"/);
    expect(exposedParameterSchemas).not.toMatch(/"enum"\s*:\s*\[[^\]]*"human"/);
    expect(JSON.stringify(resolveGateTools[0]?.parameters)).toContain("parent_agent");
  });

  it("keeps direct writeRun calls limited to audited persistence sites", () => {
    const extensionDir = join(__dirname, "../extensions");
    const sites = collectWriteRunCallSites([
      join(extensionDir, "storage.ts"),
      join(extensionDir, "conductor.ts"),
      join(extensionDir, "index.ts"),
    ]);

    expect(sites).toEqual([
      "storage.ts:mutateRun",
      "storage.ts:mutateRunWithFileLock",
      "storage.ts:mutateRunWithFileLockSync",
    ]);
  });
});
