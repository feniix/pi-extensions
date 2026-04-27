import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createGateForRepo,
  createTaskForRepo,
  getOrCreateRunForRepo,
  resolveGateFromTrustedHumanForRepo,
} from "../extensions/conductor.js";
import conductorExtension from "../extensions/index.js";
import { addConductorArtifact, writeRun } from "../extensions/storage.js";

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
    select?: (message: string, options?: string[]) => Promise<string> | string;
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

  it("shows concrete artifact and blocker details in the approval dashboard", async () => {
    const task = createTaskForRepo(repoRoot, { title: "Review me", prompt: "Needs review" });
    writeRun(
      addConductorArtifact(getOrCreateRunForRepo(repoRoot), {
        artifactId: "artifact-dashboard-test",
        type: "test_result",
        ref: "test://dashboard",
        resourceRefs: { taskId: task.taskId },
        producer: { type: "test", id: "test" },
      }),
    );
    const gate = createGateForRepo(repoRoot, {
      type: "needs_review",
      resourceRefs: { taskId: task.taskId },
      requestedDecision: "Review task?",
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
          dashboardText = component.render(120).join("\n");
          component.handleInput?.("\u001b");
          return result;
        },
        notify: () => undefined,
      },
    });

    expect(dashboardText).toContain("artifact-dashboard-test");
    expect(dashboardText).toContain("test://dashboard");
    expect(dashboardText).toContain("Blockers:");
    expect(dashboardText).toContain("Task is ready");
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
          component.handleInput?.("\r");
          return result;
        },
        input: async () => "approved from dashboard",
        notify: () => undefined,
      },
    });

    expect(dashboardText).toContain("Conductor Gate Approval Dashboard");
    expect(dashboardText).toContain("Evidence:");
    expect(dashboardText).toContain("Artifacts: none");
    expect(dashboardText).toContain("Review Packet Preview");
    expect(dashboardText).toContain("Conductor Human Review Packet");
    expect(dashboardText).toContain("Approve gate");
    expect(getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === gate.gateId)).toMatchObject({
      status: "approved",
      resolutionReason: "approved from dashboard",
    });
  });

  it("can browse open gates before opening the approval dashboard", async () => {
    const firstGate = createGateForRepo(repoRoot, {
      type: "needs_input",
      resourceRefs: {},
      requestedDecision: "First gate",
    });
    const secondGate = createGateForRepo(repoRoot, {
      type: "destructive_cleanup",
      resourceRefs: {},
      requestedDecision: "Second gate",
    });
    let queueText = "";
    let dashboardText = "";
    let customCall = 0;

    await conductorHandler()("human gates approved from queue", {
      cwd: repoRoot,
      hasUI: true,
      ui: {
        custom: async <T>(factory: Parameters<NonNullable<CommandContext["ui"]["custom"]>>[0]) => {
          customCall += 1;
          let result: T | undefined;
          const component = factory(
            { requestRender: () => undefined },
            { fg: (_color, text) => text, bold: (text) => text },
            undefined,
            (value) => {
              result = value as T;
            },
          );
          if (customCall === 1) {
            queueText = component.render(100).join("\n");
            component.handleInput?.("\u001b[B");
            component.handleInput?.("\r");
          } else {
            dashboardText = component.render(100).join("\n");
            component.handleInput?.("\r");
          }
          return result;
        },
        notify: () => undefined,
      },
    });

    expect(queueText).toContain("Conductor Gate Queue");
    expect(queueText).toContain(firstGate.gateId);
    expect(queueText).toContain(secondGate.gateId);
    expect(dashboardText).toContain("Conductor Gate Approval Dashboard");
    expect(getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === secondGate.gateId)).toMatchObject({
      status: "approved",
      resolutionReason: "approved from queue",
    });
    expect(getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === firstGate.gateId)).toMatchObject({
      status: "open",
    });
  });

  it("keeps a persistent human dashboard open across multiple gate decisions", async () => {
    const firstGate = createGateForRepo(repoRoot, {
      type: "needs_input",
      resourceRefs: {},
      requestedDecision: "First gate",
    });
    const secondGate = createGateForRepo(repoRoot, {
      type: "needs_review",
      resourceRefs: {},
      requestedDecision: "Second gate",
    });
    const dashboardTexts: string[] = [];
    let customCall = 0;
    const notifications: string[] = [];

    await conductorHandler()("human dashboard", {
      cwd: repoRoot,
      hasUI: true,
      ui: {
        custom: async <T>(factory: Parameters<NonNullable<CommandContext["ui"]["custom"]>>[0]) => {
          customCall += 1;
          let result: T | undefined;
          const component = factory(
            { requestRender: () => undefined },
            { fg: (_color, text) => text, bold: (text) => text },
            undefined,
            (value) => {
              result = value as T;
            },
          );
          const text = component.render(120).join("\n");
          dashboardTexts.push(text);
          if (text.includes("Conductor Gate Queue Dashboard")) {
            component.handleInput?.("\r");
          } else {
            component.handleInput?.("\u001b[B");
            component.handleInput?.("\r");
          }
          return result;
        },
        input: async () => "accepted in dashboard",
        notify: (message: string) => notifications.push(message),
      },
    });

    expect(customCall).toBeGreaterThanOrEqual(4);
    expect(dashboardTexts[0]).toContain("Selected Gate");
    expect(dashboardTexts[0]).toContain(firstGate.gateId);
    expect(dashboardTexts[2]).toContain(secondGate.gateId);
    expect(notifications).toContain("resolved 2 conductor gate(s)");
    expect(getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === firstGate.gateId)).toMatchObject({
      status: "approved",
      resolutionReason: "accepted in dashboard",
    });
    expect(getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === secondGate.gateId)).toMatchObject({
      status: "approved",
      resolutionReason: "accepted in dashboard",
    });
  });

  it("does not approve dashboard gates on repeated enter without explicit approval navigation", async () => {
    const gate = createGateForRepo(repoRoot, {
      type: "needs_review",
      resourceRefs: {},
      requestedDecision: "Review gate",
    });

    await conductorHandler()("human dashboard", {
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
          component.handleInput?.("\r");
          component.handleInput?.("\r");
          return result;
        },
        notify: () => undefined,
      },
    });

    expect(getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === gate.gateId)).toMatchObject({
      status: "open",
    });
  });

  it("can browse open gates with the dashboard select UI path", async () => {
    const firstGate = createGateForRepo(repoRoot, {
      type: "needs_input",
      resourceRefs: {},
      requestedDecision: "First gate",
    });
    const secondGate = createGateForRepo(repoRoot, {
      type: "needs_review",
      resourceRefs: {},
      requestedDecision: "Second gate",
    });
    const firstLabel = `${firstGate.gateId} [${firstGate.type}] ${firstGate.requestedDecision}`;
    const secondLabel = `${secondGate.gateId} [${secondGate.type}] ${secondGate.requestedDecision}`;
    const decisions = [secondLabel, "Approve gate", firstLabel, "Cancel"];
    const notifications: string[] = [];

    await conductorHandler()("human dashboard", {
      cwd: repoRoot,
      hasUI: true,
      ui: {
        select: async () => decisions.shift() ?? "Cancel",
        input: async () => "approved via dashboard select",
        notify: (message: string) => notifications.push(message),
      },
    });

    expect(getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === secondGate.gateId)).toMatchObject({
      status: "approved",
      resolutionReason: "approved via dashboard select",
    });
    expect(getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === firstGate.gateId)).toMatchObject({
      status: "open",
    });
    expect(notifications).toContain("resolved 1 conductor gate(s)");
  });

  it("reports empty, cancelled, and missing-capability dashboard states", async () => {
    const notifications: string[] = [];

    await conductorHandler()("human dashboard", {
      cwd: repoRoot,
      hasUI: true,
      ui: { notify: (message: string) => notifications.push(message) },
    });
    expect(notifications).toContain("no open conductor gates");

    const gate = createGateForRepo(repoRoot, {
      type: "needs_input",
      resourceRefs: {},
      requestedDecision: "Choose?",
    });
    await conductorHandler()("human dashboard", {
      cwd: repoRoot,
      hasUI: true,
      ui: {
        select: async () => "Cancel",
        notify: (message: string) => notifications.push(message),
      },
    });
    expect(notifications).toContain("left conductor gates unchanged");

    await conductorHandler()("human dashboard", {
      cwd: repoRoot,
      hasUI: true,
      ui: {
        notify: (message: string) => notifications.push(message),
      },
    });
    expect(notifications).toContain("trusted human gate queue requires a selectable UI");
    expect(getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === gate.gateId)).toMatchObject({
      status: "open",
    });
  });

  it("refreshes the dashboard when a selected gate becomes stale before resolution", async () => {
    const staleGate = createGateForRepo(repoRoot, {
      type: "needs_review",
      resourceRefs: {},
      requestedDecision: "Stale gate",
    });
    const nextGate = createGateForRepo(repoRoot, {
      type: "needs_input",
      resourceRefs: {},
      requestedDecision: "Next gate",
    });
    let customCall = 0;
    const notifications: string[] = [];

    await conductorHandler()("human dashboard", {
      cwd: repoRoot,
      hasUI: true,
      ui: {
        custom: async <T>(factory: Parameters<NonNullable<CommandContext["ui"]["custom"]>>[0]) => {
          customCall += 1;
          let result: T | undefined;
          const component = factory(
            { requestRender: () => undefined },
            { fg: (_color, text) => text, bold: (text) => text },
            undefined,
            (value) => {
              result = value as T;
            },
          );
          const text = component.render(120).join("\n");
          if (text.includes("Conductor Gate Queue Dashboard")) {
            component.handleInput?.("\r");
          } else if (customCall === 2) {
            resolveGateFromTrustedHumanForRepo(repoRoot, {
              gateId: staleGate.gateId,
              status: "approved",
              humanId: "ui:other-human",
              resolutionReason: "resolved elsewhere",
            });
            component.handleInput?.("\u001b[B");
            component.handleInput?.("\r");
          } else {
            component.handleInput?.("\u001b");
          }
          return result;
        },
        notify: (message: string) => notifications.push(message),
      },
    });

    expect(notifications.some((message) => message.includes("changed before decision"))).toBe(true);
    expect(getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === staleGate.gateId)).toMatchObject({
      status: "approved",
      resolutionReason: "resolved elsewhere",
    });
    expect(getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === nextGate.gateId)).toMatchObject({
      status: "open",
    });
  });

  it("can browse open gates with the select UI path", async () => {
    const firstGate = createGateForRepo(repoRoot, {
      type: "needs_input",
      resourceRefs: {},
      requestedDecision: "First gate",
    });
    const secondGate = createGateForRepo(repoRoot, {
      type: "needs_review",
      resourceRefs: {},
      requestedDecision: "Second gate",
    });
    const secondLabel = `${secondGate.gateId} [${secondGate.type}] ${secondGate.requestedDecision}`;
    const decisions = [secondLabel, "Approve gate"];

    await conductorHandler()("human gates approved via select", {
      cwd: repoRoot,
      hasUI: true,
      ui: {
        select: async () => decisions.shift() ?? "Cancel",
        notify: () => undefined,
      },
    });

    expect(getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === secondGate.gateId)).toMatchObject({
      status: "approved",
      resolutionReason: "approved via select",
    });
    expect(getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === firstGate.gateId)).toMatchObject({
      status: "open",
    });
  });

  it("reports empty and cancelled gate queues without changing gates", async () => {
    const notifications: string[] = [];

    await conductorHandler()("human gates", {
      cwd: repoRoot,
      hasUI: true,
      ui: { notify: (message: string) => notifications.push(message) },
    });
    expect(notifications).toContain("no open conductor gates");

    const gate = createGateForRepo(repoRoot, {
      type: "needs_input",
      resourceRefs: {},
      requestedDecision: "Choose?",
    });
    await conductorHandler()("human gates", {
      cwd: repoRoot,
      hasUI: true,
      ui: {
        select: async () => "Cancel",
        notify: (message: string) => notifications.push(message),
      },
    });

    expect(notifications).toContain("left conductor gates unchanged");
    expect(getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === gate.gateId)).toMatchObject({
      status: "open",
    });
  });

  it("reports missing UI capabilities instead of silently no-oping", async () => {
    const gate = createGateForRepo(repoRoot, {
      type: "needs_input",
      resourceRefs: {},
      requestedDecision: "Needs UI",
    });
    const notifications: string[] = [];

    await conductorHandler()(`human decide gate ${gate.gateId}`, {
      cwd: repoRoot,
      hasUI: true,
      ui: {
        notify: (message: string) => notifications.push(message),
      },
    });

    expect(notifications).toContain("trusted human gate approval requires a selectable UI");
    expect(getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === gate.gateId)).toMatchObject({
      status: "open",
    });
  });

  it("does not offer packet action when editor support is unavailable", async () => {
    const gate = createGateForRepo(repoRoot, {
      type: "needs_review",
      resourceRefs: {},
      requestedDecision: "Review before merge",
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
          component.handleInput?.("\r");
          return result;
        },
        input: async () => "approved without packet action",
        notify: () => undefined,
      },
    });

    expect(dashboardText).not.toContain("Open review packet");
    expect(getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === gate.gateId)).toMatchObject({
      status: "approved",
      resolutionReason: "approved without packet action",
    });
  });

  it("supports custom dashboard packet, reject, and cancel actions", async () => {
    const gate = createGateForRepo(repoRoot, {
      type: "needs_review",
      resourceRefs: {},
      requestedDecision: "Review before merge",
    });
    const customChoices = ["packet", "reject"];
    let editorText = "";

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
          const choice = customChoices.shift();
          if (choice === "packet") component.handleInput?.("\r");
          if (choice === "reject") {
            component.handleInput?.("\u001b[B");
            component.handleInput?.("\u001b[B");
            component.handleInput?.("\r");
          }
          return result;
        },
        editor: async (_title: string, text: string) => {
          editorText = text;
          return text;
        },
        input: async () => "rejected after packet review",
        notify: () => undefined,
      },
    });

    expect(editorText).toContain("Conductor Human Review Packet");
    expect(getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === gate.gateId)).toMatchObject({
      status: "rejected",
      resolutionReason: "rejected after packet review",
    });

    const cancelGate = createGateForRepo(repoRoot, {
      type: "needs_input",
      resourceRefs: {},
      requestedDecision: "Cancel?",
    });
    await conductorHandler()(`human decide gate ${cancelGate.gateId}`, {
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
          component.handleInput?.("\u001b");
          return result;
        },
        notify: () => undefined,
      },
    });
    expect(getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === cancelGate.gateId)).toMatchObject({
      status: "open",
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

  it("rejects non-UI human gate commands with machine-detectable failures", async () => {
    const gate = createGateForRepo(repoRoot, {
      type: "needs_input",
      resourceRefs: {},
      requestedDecision: "Needs UI",
    });

    await expect(
      conductorHandler()(`human decide gate ${gate.gateId}`, {
        cwd: repoRoot,
        hasUI: false,
        ui: { notify: () => undefined },
      }),
    ).rejects.toThrow("trusted human gate approval requires interactive UI");
    await expect(
      conductorHandler()("human gates", {
        cwd: repoRoot,
        hasUI: false,
        ui: { notify: () => undefined },
      }),
    ).rejects.toThrow("trusted human gate queue requires interactive UI");
    await expect(
      conductorHandler()("human dashboard", {
        cwd: repoRoot,
        hasUI: false,
        ui: { notify: () => undefined },
      }),
    ).rejects.toThrow("trusted human gate dashboard requires interactive UI");
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
