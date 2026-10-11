/**
 * Pi-independent durable cycle controller. No network calls or spending grants.
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
import { createResearchPlanner, type ResearchPlannerSnapshot } from "./research-planner.js";
import type { ResearchStepInput, ResearchSummaryParams } from "./research-planner-types.js";
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
    revision: Type.Integer({ minimum: 0 }),
    status: Type.Union([
      Type.Literal("planning"),
      Type.Literal("running"),
      Type.Literal("unknown"),
      Type.Literal("completed"),
    ]),
    archived: Type.Boolean(),
    owner: Type.Optional(ownerSchema),
    plan: snapshotSchema,
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

export async function createResearchCycles(options: ResearchCycleOptions) {
  const projectId = await researchProjectId(options.cwd);
  const directory = join(options.root, projectId);
  const owner = { sessionId: options.sessionId, token: randomUUID(), pid: process.pid };
  let activeId: string | undefined;
  let leasedId: string | undefined;
  let generation = 0;
  let localQueue: Promise<void> = Promise.resolve();

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
    return ordered(() => {
      assertCurrent();
      return action(assertCurrent);
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
    await chmod(path, 0o700);
  }

  async function transaction<T>(action: () => Promise<T>): Promise<T> {
    await initialize();
    const lockPath = join(directory, ".lock");
    const deadline = Date.now() + 1_000;
    let lock: FileHandle | undefined;
    while (!lock) {
      try {
        lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      } catch (error) {
        if (code(error) !== "EEXIST" || Date.now() >= deadline) {
          throw new Error("Research cycle storage is locked or unavailable; no state changed.", { cause: error });
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    try {
      return await action();
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
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
    return record;
  }

  async function write(record: ResearchCycle) {
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
    async list() {
      return transaction(async () => {
        const files = await readdir(directory);
        return Promise.all(
          files
            .filter((name) => name.endsWith(".json") && uuid.test(name.slice(0, -5)))
            .map((name) => read(name.slice(0, -5))),
        );
      });
    },
    async resume(id: string) {
      return activate((assertCurrent) =>
        transaction(async () => {
          assertCurrent();
          if ((activeId && activeId !== id) || (leasedId && leasedId !== id)) {
            throw new Error("Detach the owned cycle before resuming another.");
          }
          const record = await read(id);
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
    async status() {
      return activeId ? transaction(owned) : undefined;
    },
    async summary(params?: ResearchSummaryParams) {
      return transaction(async () => {
        const record = await owned();
        return `Cycle: ${record.id}\nRevision: ${record.revision}\nStatus: ${record.status}\n${createResearchPlanner(record.plan).getSummary(params)}`;
      });
    },
    async recordStep(input: ResearchStepInput) {
      if (!Value.Check(exaResearchStepParams, input)) throw new Error("Invalid research step arguments.");
      return transaction(async () => {
        const record = await owned();
        if (record.status !== "planning") throw new Error("This cycle is not editable planning state.");
        const planner = createResearchPlanner(record.plan);
        const before = planner.getStatus().stepCount;
        const result = planner.recordStep(input);
        if (result.stepCount !== before) {
          record.plan = planner.snapshot();
          record.revision++;
          await write(record);
        }
        return { ...result, cycle: record };
      });
    },
    async archive(id = activeId) {
      if (!id) throw new Error("No active research cycle to archive.");
      generation++;
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
