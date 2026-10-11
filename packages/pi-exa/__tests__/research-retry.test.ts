import { expect, it } from "vitest";
import { assessRetryHistory, type RetryAttemptFact } from "../extensions/research-retry.js";

const identity = { cycleId: "cycle", projectId: "project" };
const requestHash = "a".repeat(64);
const fact = (id: string, state: RetryAttemptFact["state"]): RetryAttemptFact => ({
  ...identity,
  id,
  operationId: `operation-${id}`,
  state,
});
const permission = (id: string) => ({
  kind: "exa-replacement-permission-v1",
  id: `permission-${id}`,
  ...identity,
  attemptId: id,
  operationId: `operation-${id}`,
  requestHash,
  originalAllowanceMicros: 100_000,
  duplicateWorkAcknowledged: true,
  additionalChargesAcknowledged: true,
  issuedAt: "2026-10-11",
  source: "command",
});

it("assesses confirmed failure/nondispatch retry history without claiming spending consent", () => {
  expect(
    assessRetryHistory([fact("failed", "failed"), fact("none", "not-dispatched")], [], identity, requestHash, "retry"),
  ).toMatchObject({
    eligible: true,
    assessmentOnly: true,
    freshBudgetAssessmentRequired: true,
    replacementPermissionIds: [],
  });
});

it("stops after any completed attempt even when other work is unknown or approval exists", () => {
  expect(
    assessRetryHistory(
      [fact("unknown", "unknown"), fact("success", "completed")],
      [permission("unknown")],
      identity,
      requestHash,
      "replace",
    ),
  ).toMatchObject({ eligible: false, reason: "CYCLE_SUCCEEDED" });
});

it("never treats generic budget/liability permission or a retry flag as duplicate-work consent", () => {
  const history = [fact("unknown", "unknown")];
  expect(
    assessRetryHistory(
      history,
      [{ ...identity, tools: ["web_research_exa"], ceilingMicros: 1_000_000 }],
      identity,
      requestHash,
      "replace",
    ),
  ).toMatchObject({ eligible: false, reason: "REPLACEMENT_APPROVAL_REQUIRED", blockedAttemptIds: ["unknown"] });
  expect(assessRetryHistory(history, [permission("unknown")], identity, requestHash, "retry")).toMatchObject({
    eligible: false,
    reason: "REPLACEMENT_APPROVAL_REQUIRED",
  });
});

it("requires unused exact-bound operator risk permission for every unresolved original attempt", () => {
  const history = [fact("one", "unknown"), fact("two", "unknown")];
  expect(assessRetryHistory(history, [permission("one")], identity, requestHash, "replace")).toMatchObject({
    eligible: false,
    blockedAttemptIds: ["two"],
  });
  expect(
    assessRetryHistory(history, [permission("one"), permission("two")], identity, requestHash, "replace"),
  ).toMatchObject({
    eligible: true,
    replacementPermissionIds: ["permission-one", "permission-two"],
    sourceAttemptIds: ["one", "two"],
  });
});

it("rejects duplicate replacement permission IDs instead of authorizing multiple originals with one identity", () => {
  expect(() =>
    assessRetryHistory(
      [fact("one", "unknown"), fact("two", "unknown")],
      [permission("one"), { ...permission("two"), id: "permission-one" }],
      identity,
      requestHash,
      "replace",
    ),
  ).toThrow("Replacement permission identity conflict.");
});

it("requires recorded command provenance instead of treating tool-shaped risk objects as operator consent", () => {
  const { source: _source, ...unattributed } = permission("unknown");
  for (const grant of [unattributed, { ...permission("unknown"), source: "tool" }]) {
    expect(assessRetryHistory([fact("unknown", "unknown")], [grant], identity, requestHash, "replace")).toMatchObject({
      eligible: false,
      reason: "REPLACEMENT_APPROVAL_REQUIRED",
    });
  }
});

it.each([
  { projectId: "other" },
  { cycleId: "other" },
  { requestHash: "b".repeat(64) },
  { operationId: "other" },
  { duplicateWorkAcknowledged: false },
  { originalAllowanceMicros: -1 },
])("rejects malformed or misbound risk permission %j", (change) => {
  expect(
    assessRetryHistory(
      [fact("unknown", "unknown")],
      [{ ...permission("unknown"), ...change }],
      identity,
      requestHash,
      "replace",
    ),
  ).toMatchObject({ eligible: false, reason: "REPLACEMENT_APPROVAL_REQUIRED" });
});

it("cannot reuse prior consumed replacement permission or bypass live unrelated execution", () => {
  const used = { ...fact("failed", "failed"), replacementPermissionIds: ["permission-unknown"] };
  expect(
    assessRetryHistory([fact("unknown", "unknown"), used], [permission("unknown")], identity, requestHash, "replace"),
  ).toMatchObject({ eligible: false, blockedAttemptIds: ["unknown"] });
  expect(
    assessRetryHistory(
      [fact("unknown", "unknown"), fact("active", "live")],
      [permission("unknown")],
      identity,
      requestHash,
      "replace",
    ),
  ).toMatchObject({ eligible: false, reason: "EXECUTION_IN_PROGRESS" });
});

it("blocks unclassified history and foreign identities rather than infer failure or consent", () => {
  expect(assessRetryHistory([fact("legacy", "unclassified")], [], identity, requestHash, "retry")).toMatchObject({
    eligible: false,
    reason: "RECOVERY_REQUIRED",
  });
  expect(() =>
    assessRetryHistory([{ ...fact("failed", "failed"), cycleId: "other" }], [], identity, requestHash, "retry"),
  ).toThrow("Retry history identity conflict.");
});

it.each([
  { cycleId: "", projectId: "project" },
  { cycleId: "cycle", projectId: "" },
])("rejects an empty durable target identity %j even when projected facts match", (target) => {
  expect(() =>
    assessRetryHistory([{ ...fact("failed", "failed"), ...target }], [], target, requestHash, "retry"),
  ).toThrow("Invalid retry target identity.");
});

it("rejects malformed classification and shared operation identities before assessing retry eligibility", () => {
  const malformed = JSON.parse(JSON.stringify({ ...fact("bad", "failed"), state: "not-a-confirmed-state" }));
  expect(() => assessRetryHistory([malformed], [], identity, requestHash, "retry")).toThrow(/classified durable facts/);
  expect(() =>
    assessRetryHistory(
      [fact("one", "failed"), { ...fact("two", "failed"), operationId: "operation-one" }],
      [],
      identity,
      requestHash,
      "retry",
    ),
  ).toThrow("Retry history identity conflict.");
});
