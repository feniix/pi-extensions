import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGateForRepo, getOrCreateRunForRepo } from "../extensions/conductor.js";
import conductorExtension from "../extensions/index.js";

type CommandContext = {
  cwd: string;
  hasUI: boolean;
  ui: { select?: (message: string) => Promise<string> | string; notify: (message: string, level?: string) => void };
};

type CommandHandler = (args: string, ctx: CommandContext) => Promise<void>;

describe("trusted human gate approval UI", () => {
  let conductorHome: string;
  let repoRoot: string;

  beforeEach(() => {
    conductorHome = mkdtempSync(join(tmpdir(), "pi-conductor-home-"));
    repoRoot = mkdtempSync(join(tmpdir(), "pi-conductor-repo-"));
    process.env.PI_CONDUCTOR_HOME = conductorHome;
  });

  afterEach(() => {
    delete process.env.PI_CONDUCTOR_HOME;
    if (existsSync(conductorHome)) rmSync(conductorHome, { recursive: true, force: true });
    if (existsSync(repoRoot)) rmSync(repoRoot, { recursive: true, force: true });
  });

  function conductorHandler(): CommandHandler {
    const commands = new Map<string, CommandHandler>();
    conductorExtension({
      registerTool: () => undefined,
      registerCommand: (name: string, command: { handler: CommandHandler }) => {
        commands.set(name, command.handler);
      },
    } as never);
    const handler = commands.get("conductor");
    if (!handler) throw new Error("conductor command handler missing");
    return handler;
  }

  it("shows evidence/readiness/timeline context before approving a gate as human", async () => {
    const gate = createGateForRepo(repoRoot, {
      type: "destructive_cleanup",
      resourceRefs: {},
      requestedDecision: "Approve cleanup?",
    });
    let prompt = "";

    await conductorHandler()(`human approve gate ${gate.gateId} looks good`, {
      cwd: repoRoot,
      hasUI: true,
      ui: {
        select: async (message: string) => {
          prompt = message;
          return "Approve gate";
        },
        notify: () => undefined,
      },
    });

    expect(prompt).toContain("Requested decision");
    expect(prompt).toContain("Readiness");
    expect(prompt).toContain("Evidence");
    expect(prompt).toContain("Timeline");
    const resolved = getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === gate.gateId);
    expect(resolved).toMatchObject({ status: "approved", resolvedBy: { type: "human" } });
  });

  it("can reject or cancel a gate without exposing model human approval tools", async () => {
    const gate = createGateForRepo(repoRoot, {
      type: "needs_input",
      resourceRefs: {},
      requestedDecision: "Choose an option",
    });

    await conductorHandler()(`human decide gate ${gate.gateId}`, {
      cwd: repoRoot,
      hasUI: true,
      ui: { select: async () => "Reject gate", notify: () => undefined },
    });
    expect(getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === gate.gateId)).toMatchObject({
      status: "rejected",
      resolvedBy: { type: "human" },
    });

    const cancelGate = createGateForRepo(repoRoot, {
      type: "needs_input",
      resourceRefs: {},
      requestedDecision: "Cancel?",
    });
    await conductorHandler()(`human decide gate ${cancelGate.gateId}`, {
      cwd: repoRoot,
      hasUI: true,
      ui: { select: async () => "Cancel", notify: () => undefined },
    });
    expect(getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === cancelGate.gateId)).toMatchObject({
      status: "open",
    });
  });
});
