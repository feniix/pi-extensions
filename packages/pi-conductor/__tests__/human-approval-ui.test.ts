import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGateForRepo, getOrCreateRunForRepo } from "../extensions/conductor.js";
import conductorExtension from "../extensions/index.js";

type CommandContext = {
  cwd: string;
  hasUI: boolean;
  ui: {
    custom?: <T>(
      factory: (
        tui: { requestRender: () => void },
        theme: { fg: (_color: string, text: string) => string; bold: (text: string) => string },
        keybindings: unknown,
        done: (value: T) => void,
      ) => { render: (width: number) => string[]; handleInput?: (data: string) => void },
    ) => Promise<T | undefined> | T | undefined;
    select?: (message: string) => Promise<string> | string;
    editor?: (title: string, text: string) => Promise<string | undefined> | string | undefined;
    input?: (message: string, placeholder?: string) => Promise<string | undefined> | string | undefined;
    notify: (message: string, level?: string) => void;
  };
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
    expect(prompt).toContain("Review Packet");
    const resolved = getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === gate.gateId);
    expect(resolved).toMatchObject({ status: "approved", resolvedBy: { type: "human" } });
  });

  it("prefers a custom approval dashboard when the host supports it", async () => {
    const gate = createGateForRepo(repoRoot, {
      type: "destructive_cleanup",
      resourceRefs: {},
      requestedDecision: "Approve cleanup?",
    });
    let dashboardText = "";

    await conductorHandler()(`human decide gate ${gate.gateId}`, {
      cwd: repoRoot,
      hasUI: true,
      ui: {
        custom: async <T>(factory: Parameters<NonNullable<CommandContext["ui"]["custom"]>>[0]) => {
          let result: T | undefined;
          const component = factory(
            { requestRender: () => undefined },
            { fg: (_color, text) => text, bold: (text) => text },
            undefined,
            (value) => {
              result = value as T;
            },
          );
          dashboardText = component.render(100).join("\n");
          component.handleInput?.("\u001b[B");
          component.handleInput?.("\r");
          return result;
        },
        input: async () => "approved from dashboard",
        notify: () => undefined,
      },
    });

    expect(dashboardText).toContain("Conductor Gate Approval Dashboard");
    expect(dashboardText).toContain("Evidence:");
    expect(dashboardText).toContain("Approve gate");
    expect(getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === gate.gateId)).toMatchObject({
      status: "approved",
      resolutionReason: "approved from dashboard",
    });
  });

  it("can open a full review packet and collect a decision reason", async () => {
    const gate = createGateForRepo(repoRoot, {
      type: "needs_review",
      resourceRefs: {},
      requestedDecision: "Review before merge",
    });
    const decisions = ["Open review packet", "Approve gate"];
    let editorText = "";

    await conductorHandler()(`human decide gate ${gate.gateId}`, {
      cwd: repoRoot,
      hasUI: true,
      ui: {
        select: async () => decisions.shift() ?? "Cancel",
        editor: async (_title: string, text: string) => {
          editorText = text;
          return text;
        },
        input: async () => "reviewed full packet",
        notify: () => undefined,
      },
    });

    expect(editorText).toContain("Conductor Human Review Packet");
    expect(getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === gate.gateId)).toMatchObject({
      status: "approved",
      resolutionReason: "reviewed full packet",
    });
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
