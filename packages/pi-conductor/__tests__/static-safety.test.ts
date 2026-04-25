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
      "index.ts:getStatusText",
      "storage.ts:mutateRun",
      "storage.ts:mutateRunWithFileLock",
      "storage.ts:mutateRunWithFileLockSync",
    ]);
  });
});
