/**
 * Pi-independent durable cycle/accounting controller. No network dispatch.
 * The Pi adapter opts in; portable/MCP tools retain their existing planner.
 */
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, type FileHandle, lstat, mkdir, open, readdir, realpath, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import {
  assessExploration,
  ExplorationApprovalError,
  type ExplorationOperation,
  estimateExploration,
  explorationOperationSchema,
  moneyMicros,
  type SpendingGrant,
  spendingGrantSchema,
  uncertaintyPermissionSchema,
  validateAccountingRecords,
} from "./research-accounting.js";
import {
  type ArtifactAssertions,
  assertArtifactTarget,
  canonicalResearchJson,
  compileResearchArtifact,
  executionPlanSchema,
  ResearchArtifactError,
  type ResearchCycleStepInput,
  selectedResearchEvidence,
  validateExecutionPlan,
} from "./research-artifacts.js";
import { candidateSchema, captureCandidates, curateEvidence, evidenceProvenanceSchema } from "./research-evidence.js";
import { createResearchPlanner, type ResearchPlannerSnapshot } from "./research-planner.js";
import type { ResearchSummaryParams } from "./research-planner-types.js";
import { withResearchStorageLock } from "./research-storage-lock.js";
import { exaResearchStepParams, researchCriterion, researchGap, researchSource } from "./schemas.js";

const strict = { additionalProperties: false };
const strings = Type.Array(Type.String());
const count = Type.Integer({ minimum: 1 });
const snapshotSchema = Type.Object(
  {
    topic: Type.Optional(Type.String()),
    steps: Type.Array(
      Type.Object(
        {
          ...Type.Omit(exaResearchStepParams, ["note", "criteria", "sources", "gaps", "assumptions"]).properties,
          sequence: count,
          warnings: strings,
        },
        strict,
      ),
    ),
    criteria: Type.Array(
      Type.Object(
        {
          ...researchCriterion.properties,
          id: Type.String(),
          ...Type.Required(Type.Pick(researchCriterion, ["category", "priority", "status"])).properties,
          evidenceRefs: strings,
          evidenceIssues: strings,
        },
        strict,
      ),
    ),
    sources: Type.Array(
      Type.Object(
        {
          ...researchSource.properties,
          id: Type.String(),
          ...Type.Required(Type.Pick(researchSource, ["sourceType", "retrievalStatus"])).properties,
          usedFor: strings,
          inspectionIssues: strings,
        },
        strict,
      ),
    ),
    gaps: Type.Array(
      Type.Object(
        {
          ...researchGap.properties,
          id: Type.String(),
          ...Type.Required(Type.Pick(researchGap, ["severity", "resolution"])).properties,
        },
        strict,
      ),
    ),
    assumptions: strings,
    branches: Type.Array(Type.Tuple([Type.String(), count])),
    warnings: strings,
    nextCriterionId: count,
    nextSourceId: count,
    nextGapId: count,
  },
  strict,
);
const ownerSchema = Type.Object({ sessionId: Type.String(), token: Type.String(), pid: count }, strict);
// Operational records are reserved for later slices and preserved verbatim.
// This slice cannot issue grants, start attempts, or alter accounting.
const objects = Type.Array(Type.Object({}, { additionalProperties: true }));
const recordSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    id: Type.String(),
    projectId: Type.String(),
    revision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    status: Type.Union([
      Type.Literal("planning"),
      Type.Literal("running"),
      Type.Literal("unknown"),
      Type.Literal("completed"),
    ]),
    archived: Type.Boolean(),
    owner: Type.Optional(ownerSchema),
    plan: snapshotSchema,
    executionPlan: Type.Optional(executionPlanSchema),
    candidates: Type.Optional(Type.Array(candidateSchema)),
    attempts: objects,
    ledger: objects,
    grants: objects,
  },
  strict,
);
export type ResearchCycle = Omit<Static<typeof recordSchema>, "plan"> & { plan: ResearchPlannerSnapshot };
export interface ResearchCycleOptions {
  root: string;
  cwd: string;
  sessionId: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const exec = promisify(execFile);

export async function researchProjectId(cwd: string): Promise<string> {
  const directory = await realpath(cwd);
  let identity = directory;
  try {
    // Do not let a shell/hook's repository or discovery overrides redefine cwd.
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
    const result = await exec("git", ["-C", directory, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      env: { ...env, LC_ALL: "C" },
    });
    identity = await realpath(result.stdout.trim());
  } catch (error) {
    if (
      !(
        typeof error === "object" &&
        error !== null &&
        "stderr" in error &&
        typeof error.stderr === "string" &&
        error.stderr.includes("not a git repository")
      )
    ) {
      throw new Error("Cannot determine canonical research project identity.", { cause: error });
    }
    // Only a confirmed non-Git directory gets cwd identity.
  }
  return createHash("sha256").update(identity).digest("hex");
}

function code(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
}

function validateCandidateSourceReferences(record: ResearchCycle) {
  for (const candidate of record.candidates ?? []) {
    if (
      candidate.sourceId !== undefined &&
      !record.plan.sources.some((source) => source.id === candidate.sourceId && source.url === candidate.url)
    )
      throw new Error(
        `Invalid candidate source reference for ${candidate.id}; correct conflicting source IDs/URLs before retrying the step.`,
      );
  }
}

function orphanExplorations(record: ResearchCycle) {
  for (const operation of record.ledger) {
    if (
      "kind" in operation &&
      operation.kind === "exa-exploration-v1" &&
      "status" in operation &&
      operation.status === "reserved"
    )
      operation.status = "unknown";
  }
}

export async function createResearchCycles(options: ResearchCycleOptions) {
  const projectId = await researchProjectId(options.cwd);
  const directory = join(options.root, projectId);
  const owner = { sessionId: options.sessionId, token: randomUUID(), pid: process.pid };
  let activeId: string | undefined;
  let leasedId: string | undefined;
  let generation = 0;
  let localQueue: Promise<void> = Promise.resolve();
  let initialization: Promise<void> | undefined;
  const failedReceiptWrites = new Set<string>();

  function assertAccountingAvailable(cycleId: string) {
    if ([...failedReceiptWrites].some((key) => key.startsWith(`${cycleId}/`)))
      throw new Error(
        "ACCOUNTING_UNAVAILABLE: Receipt durability failed; repair storage and reload/explicitly resume to inspect unknown liabilities.",
      );
  }

  async function writeReceipt(record: ResearchCycle, operationId: string) {
    const key = `${record.id}/${operationId}`;
    try {
      await write(record);
      failedReceiptWrites.delete(key);
    } catch (error) {
      failedReceiptWrites.add(key);
      throw error;
    }
  }

  function ordered<T>(action: () => Promise<T>): Promise<T> {
    const job = localQueue.then(action);
    localQueue = job.then(
      () => {},
      () => {},
    );
    return job;
  }

  function activate<T>(action: (assertCurrent: () => void) => Promise<T>) {
    const captured = generation;
    const assertCurrent = () => {
      if (captured !== generation) throw new Error("Research cycle activation was detached.");
    };
    return ordered(async () => {
      assertCurrent();
      const result = await action(assertCurrent);
      // Transaction cleanup also awaits filesystem operations; detach during
      // lock release must not turn a revoked activation into a success token.
      assertCurrent();
      return result;
    });
  }

  function filename(id: string) {
    if (!uuid.test(id)) throw new Error("Invalid research cycle ID.");
    return join(directory, `${id}.json`);
  }

  async function initialize() {
    await mkdir(options.root, { recursive: true, mode: 0o700 });
    await privateDirectory(options.root);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await privateDirectory(directory);
    // Sync every containing parent, even when another controller created the
    // hierarchy concurrently. Existing entries do not prove durable publication.
    let child = resolve(directory);
    while (dirname(child) !== child) {
      const parent = dirname(child);
      await syncDirectory(parent);
      child = parent;
    }
  }

  async function syncDirectory(path: string) {
    const handle = await open(path, constants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async function privateDirectory(path: string) {
    const info = await lstat(path);
    if (!info.isDirectory() || (process.getuid && info.uid !== process.getuid())) {
      throw new Error("Research cycle storage must be a private, owned directory, not a symlink.");
    }
    if ((info.mode & 0o777) !== 0o700) await chmod(path, 0o700);
  }

  async function transaction<T>(action: () => Promise<T>): Promise<T> {
    initialization ??= initialize().catch((error: unknown) => {
      initialization = undefined;
      throw error;
    });
    await initialization;
    // Keep ownership/non-symlink checks fresh, without repeating hierarchy sync.
    await privateDirectory(options.root);
    await privateDirectory(directory);
    return withResearchStorageLock(directory, action);
  }

  async function discover() {
    return transaction(async () => {
      const files = await readdir(directory);
      const ids = files
        .filter((name) => name.endsWith(".json") && uuid.test(name.slice(0, -5)))
        .map((name) => name.slice(0, -5))
        .sort();
      const results = await Promise.allSettled(ids.map(read));
      return {
        cycles: results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
        unreadableCycleIds: results.flatMap((result, index) => (result.status === "rejected" ? [ids[index]] : [])),
      };
    });
  }

  async function read(id: string): Promise<ResearchCycle> {
    const file = await open(filename(id), constants.O_RDONLY | constants.O_NOFOLLOW);
    let value: unknown;
    try {
      const info = await file.stat();
      if (!info.isFile() || (process.getuid && info.uid !== process.getuid()) || (info.mode & 0o077) !== 0) {
        throw new Error("Research cycle record must be a private, owned regular file.");
      }
      value = JSON.parse(await file.readFile("utf8"));
    } finally {
      await file.close();
    }
    if (!Value.Check(recordSchema, value) || value.id !== id || value.projectId !== projectId) {
      throw new Error("Invalid or unsupported research cycle record; no state changed.");
    }
    const record = value as ResearchCycle;
    // Validate semantic identity invariants and derive diagnostics from facts,
    // not cached evidence/inspection flags from disk.
    record.plan = createResearchPlanner(record.plan).snapshot();
    validateAccountingRecords(record.grants, record.ledger, { cycleId: record.id, projectId: record.projectId });
    const candidateIds = new Set<string>();
    for (const candidate of record.candidates ?? []) {
      if (
        candidateIds.has(candidate.id) ||
        captureCandidates({ results: [{ url: candidate.url }] }, candidate.provenance[0])[0]?.id !== candidate.id
      )
        throw new Error("Invalid candidate identity.");
      candidateIds.add(candidate.id);
      const operationIds = new Set<string>();
      for (const provenance of candidate.provenance) {
        const operation = record.ledger.find((entry) => "id" in entry && entry.id === provenance.operationId);
        if (
          operationIds.has(provenance.operationId) ||
          !Value.Check(explorationOperationSchema, operation) ||
          operation.status === "not-dispatched" ||
          operation.tool !== provenance.tool ||
          operation.requestHash !== provenance.requestHash ||
          operation.revision !== provenance.revision
        )
          throw new Error("Invalid candidate provenance.");
        operationIds.add(provenance.operationId);
      }
      if (
        candidate.selectedProvenance?.some(
          (entry) =>
            !candidate.provenance.some((known) => canonicalResearchJson(entry) === canonicalResearchJson(known)),
        )
      )
        throw new Error("Invalid selected evidence provenance.");
    }
    validateCandidateSourceReferences(record);
    return record;
  }

  async function write(record: ResearchCycle) {
    // Enforce the same source identity invariant on publication and restore.
    // A planner warning must never make durable curation unreadable.
    validateCandidateSourceReferences(record);
    const target = filename(record.id);
    const temporary = `${target}.${randomUUID()}.tmp`;
    let file: FileHandle | undefined;
    try {
      file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      await file.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await file.sync();
      await file.close();
      file = undefined;
      await rename(temporary, target);
      await syncDirectory(directory);
    } finally {
      await file?.close();
      await unlink(temporary).catch((error: unknown) => {
        if (code(error) !== "ENOENT") throw error;
      });
    }
  }

  function owns(record: ResearchCycle) {
    return record.owner?.sessionId === owner.sessionId && record.owner.token === owner.token;
  }

  async function owned() {
    if (!activeId) throw new Error("No active research cycle. Use /exa-research start or resume.");
    const record = await read(activeId);
    if (!owns(record)) throw new Error("Research cycle ownership changed; explicitly resume.");
    return record;
  }

  async function detach() {
    generation++;
    // Detach locally even if disk becomes unavailable; do not act on stale state.
    activeId = undefined;
    return ordered(async () => {
      if (!leasedId) return;
      const id = leasedId;
      await transaction(async () => {
        let record: ResearchCycle;
        try {
          record = await read(id);
        } catch (error) {
          if (code(error) !== "ENOENT") throw error;
          leasedId = undefined;
          return;
        }
        if (owns(record)) {
          orphanExplorations(record);
          delete record.owner;
          await write(record);
        }
        leasedId = undefined;
      });
    });
  }

  return {
    projectId,
    async start(topic: string) {
      if (!topic.trim()) throw new Error("Research topic must not be empty.");
      return activate((assertCurrent) =>
        transaction(async () => {
          assertCurrent();
          if (activeId || leasedId) throw new Error("Archive or detach the owned cycle before starting another.");
          const planner = createResearchPlanner();
          const record: ResearchCycle = {
            schemaVersion: 1,
            id: randomUUID(),
            projectId,
            revision: 0,
            status: "planning",
            archived: false,
            owner,
            plan: { ...planner.snapshot(), topic: topic.trim() },
            attempts: [],
            ledger: [],
            grants: [],
          };
          leasedId = record.id;
          await write(record);
          assertCurrent();
          activeId = record.id;
          return structuredClone(record);
        }),
      );
    },
    async inspect(id: string) {
      return transaction(() => read(id));
    },
    discover,
    async list() {
      const found = await discover();
      if (found.unreadableCycleIds.length)
        throw new Error("Research cycle attribution is incomplete; unreadable records require repair.");
      return found.cycles;
    },
    async resume(id: string) {
      return activate((assertCurrent) =>
        transaction(async () => {
          assertCurrent();
          if ((activeId && activeId !== id) || (leasedId && leasedId !== id)) {
            throw new Error("Detach the owned cycle before resuming another.");
          }
          const record = await read(id);
          if (!owns(record)) orphanExplorations(record);
          if (record.owner && !owns(record)) {
            try {
              process.kill(record.owner.pid, 0);
              throw new Error("Research cycle is owned by another live session/runtime.");
            } catch (error) {
              if (code(error) !== "ESRCH") throw error;
            }
          }
          record.owner = { ...owner };
          record.archived = false;
          leasedId = id;
          await write(record);
          assertCurrent();
          activeId = id;
          return record;
        }),
      );
    },
    detach,
    async status(assertions: ArtifactAssertions = {}) {
      return activeId
        ? transaction(async () => {
            const record = await owned();
            if (assertions.artifactHash !== undefined) compileResearchArtifact(record, assertions);
            else assertArtifactTarget(record, assertions);
            return record;
          })
        : undefined;
    },
    async summary(params?: ResearchSummaryParams) {
      return transaction(async () => {
        const record = await owned();
        const selectedEvidence = selectedResearchEvidence(record);
        const selectedIds = new Set(selectedEvidence.map((entry) => entry.sourceId));
        const plan = { ...record.plan, sources: record.plan.sources.filter((source) => selectedIds.has(source.id)) };
        return `Cycle: ${record.id}\nRevision: ${record.revision}\nStatus: ${record.status}\n${createResearchPlanner(plan).getSummary(params)}\nSelected evidence (untrusted context): ${JSON.stringify(selectedEvidence)}`;
      });
    },
    async preview(assertions: ArtifactAssertions = {}) {
      return transaction(async () => compileResearchArtifact(await owned(), assertions));
    },
    async grantBudget(cycleId: string, dollars: number, tools: string[] = ["web_search_exa"]) {
      return ordered(() =>
        transaction(async () => {
          const record = await owned();
          assertArtifactTarget(record, { cycleId });
          if (record.archived || record.status !== "planning") throw new Error("CYCLE_NOT_EXECUTABLE");
          const grant = {
            kind: "exa-grant-v1",
            id: randomUUID(),
            cycleId: record.id,
            projectId,
            issuerSessionId: owner.sessionId,
            source: "command",
            issuedAt: new Date().toISOString(),
            ceilingMicros: moneyMicros(dollars, true),
            tools: [...tools],
          };
          if (!Value.Check(spendingGrantSchema, grant)) throw new Error("Invalid spending scope or amount.");
          record.grants.push(grant as SpendingGrant);
          await write(record);
          return record;
        }),
      );
    },
    async reserveExploration(tool: string, args: Record<string, unknown>, assertions: ArtifactAssertions = {}) {
      const request = structuredClone(args);
      const reference = structuredClone(assertions);
      return activate((assertCurrent) =>
        transaction(async () => {
          const record = await owned();
          assertCurrent();
          assertAccountingAvailable(record.id);
          assertArtifactTarget(record, reference);
          if (record.archived || record.status !== "planning") throw new Error("CYCLE_NOT_EXECUTABLE");
          const estimate = estimateExploration(tool, request);
          const requestHash = createHash("sha256").update(canonicalResearchJson({ tool, request })).digest("hex");
          const assessment = assessExploration(
            record.grants,
            record.ledger,
            estimate,
            tool,
            {
              cycleId: record.id,
              projectId: record.projectId,
            },
            requestHash,
          );
          if (!assessment.canDispatch)
            throw new ExplorationApprovalError(record.id, tool, requestHash, request, assessment);
          if (assessment.proposedMicros === null) throw new Error("UNCERTAINTY_APPROVAL_REQUIRED");
          const operation: ExplorationOperation = {
            kind: "exa-exploration-v1",
            id: randomUUID(),
            cycleId: record.id,
            revision: record.revision,
            tool,
            requestHash,
            estimateMicros: assessment.proposedMicros,
            basis:
              estimate.dollars === null
                ? `Operator-assessed exact request; permission ${assessment.requestPermissionId}; not a vendor cap.`
                : estimate.basis,
            ...(assessment.requestPermissionId ? { requestPermissionId: assessment.requestPermissionId } : {}),
            status: "reserved",
            createdAt: new Date().toISOString(),
          };
          assertCurrent();
          record.ledger.push(operation);
          await write(record);
          assertCurrent();
          return { operation, assessment };
        }),
      );
    },
    explorationEvidenceObserver(cycleId: string, operationId: string, requestHash: string) {
      const captureGeneration = generation;
      const current = () => captureGeneration === generation && activeId === cycleId;
      return async (response: unknown) => {
        // This temporary snapshot is never written as a response archive.
        // The policy below retains only bounded source metadata.
        const snapshot = structuredClone(response);
        return ordered(() =>
          transaction(async () => {
            if (!current()) return { captured: false };
            const record = await owned();
            if (!current() || record.archived || record.status !== "planning") return { captured: false };
            const operation = record.ledger.find((entry) => "id" in entry && entry.id === operationId);
            if (
              !Value.Check(explorationOperationSchema, operation) ||
              operation.cycleId !== cycleId ||
              operation.requestHash !== requestHash ||
              operation.status === "not-dispatched"
            )
              throw new Error("Operation identity conflict.");
            const provenance = {
              operationId,
              requestHash,
              tool: operation.tool,
              revision: operation.revision,
              retrievedAt: new Date().toISOString(),
            };
            if (!Value.Check(evidenceProvenanceSchema, provenance)) throw new Error("Invalid evidence provenance.");
            const candidates = captureCandidates(snapshot, provenance, record.candidates);
            if (canonicalResearchJson(candidates) !== canonicalResearchJson(record.candidates ?? [])) {
              record.candidates = candidates;
              await write(record);
            }
            return { captured: current(), candidateCount: candidates.length };
          }),
        );
      };
    },
    async grantUncertainty(cycleId: string, targetType: "request" | "liability", subjectId: string, dollars: number) {
      return activate((assertCurrent) =>
        transaction(async () => {
          const record = await owned();
          assertCurrent();
          assertArtifactTarget(record, { cycleId });
          if (record.archived || record.status !== "planning") throw new Error("CYCLE_NOT_EXECUTABLE");
          if (targetType === "request" && !/^[a-f0-9]{64}$/.test(subjectId))
            throw new Error("An exact request hash is required.");
          if (
            targetType === "liability" &&
            !record.ledger.some(
              (entry) =>
                Value.Check(explorationOperationSchema, entry) &&
                entry.id === subjectId &&
                entry.status === "unknown" &&
                !entry.conflictingMicros?.length,
            )
          )
            throw new Error("An existing unresolved operation is required.");
          const permission = {
            kind: "exa-uncertainty-v1",
            id: randomUUID(),
            cycleId: record.id,
            projectId,
            issuerSessionId: owner.sessionId,
            source: "command",
            issuedAt: new Date().toISOString(),
            targetType,
            subjectId,
            allowanceMicros: moneyMicros(dollars, true),
          };
          if (!Value.Check(uncertaintyPermissionSchema, permission)) throw new Error("Invalid uncertainty permission.");
          record.grants.push(permission);
          assertCurrent();
          await write(record);
          assertCurrent();
          return record;
        }),
      );
    },
    async reconcileExploration(
      cycleId: string,
      operationId: string,
      requestHash: string,
      receipt: { totalDollars?: number },
    ) {
      const copy = structuredClone(receipt);
      return ordered(() =>
        transaction(async () => {
          // Receipt-only capability: deliberately does not acquire ownership.
          const record = await read(cycleId);
          const operation = record.ledger.find((entry) => "id" in entry && entry.id === operationId);
          if (
            !Value.Check(explorationOperationSchema, operation) ||
            operation.cycleId !== cycleId ||
            operation.requestHash !== requestHash
          ) {
            throw new Error("Operation identity conflict.");
          }
          let total: number | undefined;
          try {
            if (copy.totalDollars !== undefined) total = moneyMicros(copy.totalDollars);
          } catch {
            // Malformed usage is missing evidence, not a zero-dollar receipt.
          }
          if (operation.status === "reported" && operation.reportedMicros === total) {
            if (failedReceiptWrites.has(`${cycleId}/${operationId}`)) await writeReceipt(record, operationId);
            return record;
          }
          if (operation.reportedMicros !== undefined) {
            // Missing evidence cannot revoke a genuine prior usage receipt.
            if (total === undefined) return record;
            if (operation.reportedMicros === total) {
              operation.status = "reported";
            } else {
              operation.status = "reported";
              operation.conflictingMicros = [...new Set([...(operation.conflictingMicros ?? []), total])];
            }
            await writeReceipt(record, operationId);
            return record;
          }
          if (total === undefined) operation.status = "unknown";
          else {
            operation.status = "reported";
            operation.reportedMicros = total;
          }
          await writeReceipt(record, operationId);
          return record;
        }),
      );
    },
    async explorationDispatchGuard(cycleId: string, operationId: string, requestHash: string) {
      return activate((assertCurrent) =>
        transaction(async () => {
          const record = await owned();
          assertCurrent();
          assertAccountingAvailable(record.id);
          const operation = record.ledger.find((entry) => "id" in entry && entry.id === operationId);
          if (
            !Value.Check(explorationOperationSchema, operation) ||
            operation.cycleId !== cycleId ||
            operation.requestHash !== requestHash ||
            operation.status !== "reserved"
          )
            throw new Error("Operation identity conflict.");
          assertArtifactTarget(record, { cycleId, expectedRevision: operation.revision });
          if (record.archived || record.status !== "planning") throw new Error("CYCLE_NOT_EXECUTABLE");
          const assessment = assessExploration(
            record.grants,
            record.ledger,
            { dollars: 0, basis: "Recheck all held exposure before SDK invocation." },
            operation.tool,
            { cycleId: record.id, projectId: record.projectId },
          );
          if (!assessment.canDispatch) throw new Error(`${assessment.reason}: dispatch permission changed.`);
          return assertCurrent;
        }),
      );
    },
    async releaseUndispatchedExploration(cycleId: string, operationId: string, requestHash: string) {
      return ordered(() =>
        transaction(async () => {
          const record = await read(cycleId);
          const operation = record.ledger.find((entry) => "id" in entry && entry.id === operationId);
          if (
            !Value.Check(explorationOperationSchema, operation) ||
            operation.cycleId !== cycleId ||
            operation.requestHash !== requestHash ||
            operation.reportedMicros !== undefined
          )
            throw new Error("Operation identity conflict.");
          operation.status = "not-dispatched";
          await write(record);
          return record;
        }),
      );
    },
    async recordStep(input: ResearchCycleStepInput) {
      if (!Value.Check(exaResearchStepParams, input)) throw new Error("Invalid research step arguments.");
      const update = structuredClone(input);
      if (update.executionPlan !== undefined) validateExecutionPlan(update.executionPlan);
      return transaction(async () => {
        const record = await owned();
        if (record.status !== "planning") throw new Error("This cycle is not editable planning state.");
        assertArtifactTarget(record, update);
        const planner = createResearchPlanner(record.plan);
        const before = planner.getStatus().stepCount;
        const { evidence, executionPlan, cycleId: _cycleId, expectedRevision: _revision, ...plannerInput } = update;
        if (evidence !== undefined && executionPlan?.selectedEvidence !== undefined)
          throw new Error("Choose evidence decisions or executionPlan.selectedEvidence in one update, not both.");
        const curation =
          evidence === undefined
            ? undefined
            : curateEvidence(
                record.candidates ?? [],
                evidence,
                record.plan.sources,
                record.executionPlan?.selectedEvidence ?? [],
              );
        const result = planner.recordStep({
          ...plannerInput,
          ...(curation ? { sources: [...(plannerInput.sources ?? []), ...curation.sourceUpdates] } : {}),
        });
        if (result.stepCount === before && (executionPlan !== undefined || evidence !== undefined))
          throw new ResearchArtifactError([
            {
              code: "STEP_REJECTED",
              path: "thought_number",
              message: `Execution plan was not changed: ${result.step.warnings.join(" ")}`,
            },
          ]);
        if (result.stepCount !== before) {
          if (record.revision === Number.MAX_SAFE_INTEGER)
            throw new ResearchArtifactError([
              {
                code: "REVISION_EXHAUSTED",
                path: "revision",
                message: "Archive this cycle and explicitly start another.",
              },
            ]);
          record.plan = planner.snapshot();
          if (curation) {
            record.candidates = curation.candidates;
            record.executionPlan = { ...record.executionPlan, selectedEvidence: curation.selectedEvidence };
          }
          if (executionPlan !== undefined) {
            record.executionPlan = { ...record.executionPlan, ...executionPlan };
            validateExecutionPlan(record.executionPlan, record.plan.sources);
          }
          if (record.executionPlan !== undefined) validateExecutionPlan(record.executionPlan, record.plan.sources);
          for (const candidate of record.candidates ?? []) {
            if (candidate.sourceId !== undefined)
              candidate.decision = record.executionPlan?.selectedEvidence?.some(
                (entry) => entry.sourceId === candidate.sourceId,
              )
                ? "selected"
                : "rejected";
          }
          record.revision++;
          await write(record);
        }
        return { ...result, cycle: record };
      });
    },
    async archive(id = activeId) {
      if (!id) throw new Error("No active research cycle to archive.");
      if (id === activeId || id === leasedId) generation++;
      return ordered(() =>
        transaction(async () => {
          const record = await read(id);
          if (record.owner && !owns(record)) throw new Error("Cannot archive another owner's research cycle.");
          record.archived = true;
          delete record.owner;
          await write(record);
          if (activeId === id) activeId = undefined;
          if (leasedId === id) leasedId = undefined;
          return record;
        }),
      );
    },
  };
}
export type ResearchCycles = Awaited<ReturnType<typeof createResearchCycles>>;
