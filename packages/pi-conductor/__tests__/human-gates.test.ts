import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGateForRepo, getOrCreateRunForRepo } from "../extensions/conductor.js";
import {
  openHumanGateQueueDashboard,
  resolveHumanGateDecision,
  toHumanGateDecisionUi,
} from "../extensions/human-gates.js";

describe("human gate UI adapter", () => {
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
  it("adapts supported trusted UI capabilities", async () => {
    const calls: string[] = [];
    const source = {
      notify(message: string) {
        calls.push(`notify:${message}`);
      },
      select() {
        calls.push("select");
        return "Cancel";
      },
      input() {
        calls.push("input");
        return "reason";
      },
    };

    const ui = toHumanGateDecisionUi(source);
    ui.notify("hello");
    await ui.select?.("Choose", ["Cancel"]);
    await ui.input?.("Reason");

    expect(calls).toEqual(["notify:hello", "select", "input"]);
    expect(ui.custom).toBeUndefined();
    expect(ui.editor).toBeUndefined();
  });

  it("rejects UI objects without notify support", () => {
    expect(() => toHumanGateDecisionUi(null)).toThrow("trusted human gate UI is unavailable");
    expect(() => toHumanGateDecisionUi({ select: () => "Cancel" })).toThrow(
      "trusted human gate UI requires notify support",
    );
  });

  it("treats invalid custom and select action values as cancellation", async () => {
    const customGate = createGateForRepo(repoRoot, {
      type: "needs_review",
      resourceRefs: {},
      requestedDecision: "Review custom?",
    });
    const customNotifications: string[] = [];
    await resolveHumanGateDecision(repoRoot, customGate.gateId, undefined, {
      custom: async () => "approve_all" as never,
      notify: (message: string) => customNotifications.push(message),
    });
    expect(customNotifications).toContain("trusted human gate approval returned an invalid action");
    expect(getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === customGate.gateId)).toMatchObject({
      status: "open",
    });

    const selectGate = createGateForRepo(repoRoot, {
      type: "needs_review",
      resourceRefs: {},
      requestedDecision: "Review select?",
    });
    const selectNotifications: string[] = [];
    await resolveHumanGateDecision(repoRoot, selectGate.gateId, undefined, {
      select: async () => "Approve everything",
      notify: (message: string) => selectNotifications.push(message),
    });
    expect(selectNotifications).toContain("trusted human gate approval returned an invalid action");
    expect(getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === selectGate.gateId)).toMatchObject({
      status: "open",
    });
  });

  it("skips expired open gates in the persistent dashboard", async () => {
    const expiredGate = createGateForRepo(repoRoot, {
      type: "needs_review",
      resourceRefs: {},
      requestedDecision: "Expired?",
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    const liveGate = createGateForRepo(repoRoot, {
      type: "needs_input",
      resourceRefs: {},
      requestedDecision: "Live?",
    });
    const notifications: string[] = [];

    await openHumanGateQueueDashboard(repoRoot, {
      select: async (_message, options) =>
        options.find((option) => option.includes(liveGate.gateId)) ? "Cancel" : "Cancel",
      notify: (message: string) => notifications.push(message),
    });

    expect(notifications).toContain(
      "skipped 1 expired conductor gate(s); run reconcile or inspect conductor_list_gates",
    );
    expect(getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === expiredGate.gateId)).toMatchObject({
      status: "open",
    });
    expect(getOrCreateRunForRepo(repoRoot).gates.find((entry) => entry.gateId === liveGate.gateId)).toMatchObject({
      status: "open",
    });
  });
});
