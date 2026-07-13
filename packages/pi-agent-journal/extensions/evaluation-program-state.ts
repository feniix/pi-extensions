const SHA256 = /^[a-f0-9]{64}$/;
const GIT_COMMIT = /^[a-f0-9]{40}$/;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const BRANCH = /^(?!.*\/\/)[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const CREDENTIAL_LIKE =
  /(?:gh[pousr]_|github_pat_|sk-[A-Za-z0-9]|AKIA[0-9A-Z]{16}|xox[abprs]-|glpat-|npm_|pypi-|-----BEGIN|Bearer\s)/;

// Schema v1 intentionally stops at the infrastructure acceptance decision.
// Later stages require a new committed schema after the corresponding user gate.
const STAGES = ["infrastructure-hardening", "awaiting-infrastructure-acceptance", "blocked"] as const;
const PENDING_ACTIONS = ["none", "accept-infrastructure"] as const;
const CLEANUP_STATES = [
  "private-traces-not-committed",
  "verified-and-deleted",
  "synthetic-evidence-deleted",
  "retained-private",
] as const;

type Stage = (typeof STAGES)[number];
type PendingAction = (typeof PENDING_ACTIONS)[number];

export class EvaluationProgramStateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationProgramStateValidationError";
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new EvaluationProgramStateValidationError(`${field} must be a plain JSON object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], field: string): void {
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) {
    throw new EvaluationProgramStateValidationError(`${field} contains non-JSON fields`);
  }
  const actual = (ownKeys as string[]).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new EvaluationProgramStateValidationError(`${field} contains unknown or missing fields`);
  }
}

function jsonArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new EvaluationProgramStateValidationError(`${field} must be a plain JSON array`);
  }
  const expected = [...Array.from({ length: value.length }, (_, index) => String(index)), "length"].sort();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.some((key) => typeof key !== "string") ||
    JSON.stringify((ownKeys as string[]).sort()) !== JSON.stringify(expected)
  ) {
    throw new EvaluationProgramStateValidationError(`${field} contains non-JSON fields or sparse items`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (Object.getOwnPropertyDescriptor(value, String(index))?.enumerable !== true) {
      throw new EvaluationProgramStateValidationError(`${field}[${index}] must be enumerable JSON data`);
    }
  }
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new EvaluationProgramStateValidationError(`${field} is invalid`);
  }
  return value as T;
}

function integer(value: unknown, field: string, minimum = 1): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new EvaluationProgramStateValidationError(`${field} must be a safe integer of at least ${minimum}`);
  }
  return value as number;
}

function safeString(value: unknown, pattern: RegExp, field: string): string {
  if (typeof value !== "string" || !pattern.test(value) || CREDENTIAL_LIKE.test(value)) {
    throw new EvaluationProgramStateValidationError(`${field} is not safe metadata`);
  }
  return value;
}

function digestOrNull(value: unknown, field: string): string | null {
  if (value === null) return null;
  return safeString(value, SHA256, field);
}

function opaqueIds(value: unknown, field: string): string[] {
  const array = jsonArray(value, field);
  const ids = array.map((item, index) => safeString(item, OPAQUE_ID, `${field}[${index}]`));
  if (new Set(ids).size !== ids.length) throw new EvaluationProgramStateValidationError(`${field} contains duplicates`);
  return ids;
}

function validateHistoricalGuard(value: unknown): void {
  const guard = record(value, "historicalEvidenceGuard");
  exactKeys(guard, ["path", "digest"], "historicalEvidenceGuard");
  if (guard.path !== "docs/evaluations/agent-work-journal-historical-guard.json") {
    throw new EvaluationProgramStateValidationError("historicalEvidenceGuard.path is invalid");
  }
  safeString(guard.digest, SHA256, "historicalEvidenceGuard.digest");
}

function validatePullRequests(value: unknown): void {
  const pullRequests = jsonArray(value, "reconciledPullRequests");
  const numbers = new Set<number>();
  for (const [index, item] of pullRequests.entries()) {
    const receipt = record(item, `reconciledPullRequests[${index}]`);
    exactKeys(
      receipt,
      ["prNumber", "branch", "mergeCommit", "ciRunId", "ciConclusion"],
      `reconciledPullRequests[${index}]`,
    );
    const prNumber = integer(receipt.prNumber, `reconciledPullRequests[${index}].prNumber`);
    if (numbers.has(prNumber))
      throw new EvaluationProgramStateValidationError("reconciledPullRequests contains duplicates");
    numbers.add(prNumber);
    safeString(receipt.branch, BRANCH, `reconciledPullRequests[${index}].branch`);
    safeString(receipt.mergeCommit, GIT_COMMIT, `reconciledPullRequests[${index}].mergeCommit`);
    integer(receipt.ciRunId, `reconciledPullRequests[${index}].ciRunId`);
    if (receipt.ciConclusion !== "success") {
      throw new EvaluationProgramStateValidationError("reconciled pull request CI must be successful");
    }
  }
}

function validateVersions(
  value: unknown,
  latestCompletedVersion: number,
): Array<{ version: number; terminalState: string }> {
  const versionArray = jsonArray(value, "versions");
  if (versionArray.length === 0) {
    throw new EvaluationProgramStateValidationError("versions must be a non-empty array");
  }
  const versions = versionArray.map((item, index) => {
    const version = record(item, `versions[${index}]`);
    exactKeys(
      version,
      ["version", "terminalState", "failureStage", "taskIds", "runIds", "resultDigest", "cleanupState"],
      `versions[${index}]`,
    );
    const number = integer(version.version, `versions[${index}].version`);
    const terminalState = oneOf(version.terminalState, ["PASS", "FAIL"] as const, `versions[${index}].terminalState`);
    if (terminalState === "FAIL") safeString(version.failureStage, OPAQUE_ID, `versions[${index}].failureStage`);
    else if (version.failureStage !== null)
      throw new EvaluationProgramStateValidationError(`versions[${index}].failureStage must be null for PASS`);
    opaqueIds(version.taskIds, `versions[${index}].taskIds`);
    opaqueIds(version.runIds, `versions[${index}].runIds`);
    safeString(version.resultDigest, SHA256, `versions[${index}].resultDigest`);
    oneOf(version.cleanupState, CLEANUP_STATES, `versions[${index}].cleanupState`);
    return { version: number, terminalState };
  });
  if (
    versions.some((item, index) => item.version !== index + 1) ||
    versions.at(-1)?.version !== latestCompletedVersion
  ) {
    throw new EvaluationProgramStateValidationError("versions must be sequential through latestCompletedVersion");
  }
  return versions;
}

function validateTransition(
  stage: Stage,
  pending: PendingAction,
  acceptedDigest: string | null,
  latestCompletedVersion: number,
  versions: Array<{ terminalState: string }>,
): void {
  if (
    acceptedDigest !== null ||
    latestCompletedVersion !== 3 ||
    versions.some((version) => version.terminalState !== "FAIL")
  ) {
    throw new EvaluationProgramStateValidationError("schema v1 cannot claim accepted infrastructure or V4 progress");
  }
  const expectedPending: Record<Stage, PendingAction> = {
    "infrastructure-hardening": "none",
    "awaiting-infrastructure-acceptance": "accept-infrastructure",
    blocked: "none",
  };
  if (pending !== expectedPending[stage]) {
    throw new EvaluationProgramStateValidationError("pending user action does not match the current stage");
  }
}

export function validateEvaluationProgramState(value: unknown): Record<string, unknown> {
  const state = record(value, "programState");
  exactKeys(
    state,
    [
      "schemaVersion",
      "currentStage",
      "latestCompletedVersion",
      "acceptedInfrastructureReceiptDigest",
      "pendingUserAction",
      "predecessorCutoverPerformed",
      "historicalEvidenceGuard",
      "reconciledPullRequests",
      "versions",
    ],
    "programState",
  );
  if (state.schemaVersion !== 1) throw new EvaluationProgramStateValidationError("unsupported program state schema");
  const stage = oneOf(state.currentStage, STAGES, "currentStage");
  const latestCompletedVersion = integer(state.latestCompletedVersion, "latestCompletedVersion");
  const acceptedDigest = digestOrNull(state.acceptedInfrastructureReceiptDigest, "acceptedInfrastructureReceiptDigest");
  const pending = oneOf(state.pendingUserAction, PENDING_ACTIONS, "pendingUserAction");
  if (state.predecessorCutoverPerformed !== false) {
    throw new EvaluationProgramStateValidationError("predecessor cutover is forbidden by this program");
  }
  validateHistoricalGuard(state.historicalEvidenceGuard);
  validatePullRequests(state.reconciledPullRequests);
  const versions = validateVersions(state.versions, latestCompletedVersion);
  validateTransition(stage, pending, acceptedDigest, latestCompletedVersion, versions);
  return state;
}
