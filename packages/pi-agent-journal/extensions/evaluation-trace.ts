import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  AVOIDABLE_MAINTENANCE_KINDS,
  computeV2DerivedTraceDigest,
  NECESSARY_SAFETY_KINDS,
  type V2Intervention,
  type V2InterventionKind,
  type V2MaterialCase,
  type V2RunTrace,
} from "./evaluation-v2.js";

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const DEFAULT_MAX_EVENTS = 10_000;
const DEFAULT_MAX_LINE_BYTES = 64 * 1024;

export class TraceNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TraceNormalizationError";
  }
}

export interface NormalizedReadEvent {
  id: string;
  kind: "read" | "search" | "list";
  sequence: number;
  keyDigest: string;
}

export interface NormalizedEventOrder {
  id: string;
  kind: "read" | "search" | "list" | "avoidable-maintenance" | "necessary-safety" | "material-case";
  sequence: number;
}

export interface NormalizedV2Trace extends V2RunTrace {
  repositoryReadEvents: NormalizedReadEvent[];
  eventOrder: NormalizedEventOrder[];
  avoidableMaintenanceCount: number;
  necessarySafetyCount: number;
}

function opaque(value: unknown, field: string): string {
  if (typeof value !== "string" || !OPAQUE_ID.test(value)) {
    throw new TraceNormalizationError(`${field} must be an opaque identifier`);
  }
  return value;
}

function integer(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0)
    throw new TraceNormalizationError(`${field} must be non-negative`);
  return value as number;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function repositoryPathKey(path: string, workspaceRoot: string): string | undefined {
  const root = resolve(workspaceRoot);
  const absolute = isAbsolute(path) ? resolve(path) : resolve(root, path);
  const local = relative(root, absolute);
  if (local === "" || local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) return undefined;
  return local.split(sep).join("/");
}

function normalizedCommandKey(command: string, workspaceRoot: string): string {
  const root = resolve(workspaceRoot);
  return command
    .replaceAll(`${root}${sep}`, "")
    .replaceAll(root, ".")
    .replace(/(^|\s)\.\//g, "$1")
    .trim()
    .replace(/\s+/g, " ");
}

function shellOperations(
  command: string,
  workspaceRoot: string,
): Array<{ kind: "read" | "search" | "list"; key: string }> {
  if (/(?:^|\s)(?:bash|sh|zsh)\s+-c\b|\([^)]*\b(?:cat|sed|head|tail|rg|grep|find|ls)\b/.test(command)) {
    throw new TraceNormalizationError("unsupported shell read form");
  }
  if (/(?:^|[\s'"])\.\.(?:\/|[\s'"]|$)/.test(command)) {
    throw new TraceNormalizationError("shell read target escapes repository");
  }
  if (/(?:^|\s)(?:awk|gawk|python\d*|perl|ruby|less|more|cut|sort|uniq|jq|xargs)\b|(?:^|\s)<\s*\S+/.test(command)) {
    throw new TraceNormalizationError("unsupported shell read form");
  }
  return command
    .split(/(?:&&|\|\||;|\|)/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((piece) => {
      const executable = piece.match(/^(?:env\s+\S+\s+)*(?:command\s+)?([\w.-]+)/)?.[1];
      const tokens = (piece.match(/"(?:\\.|[^"])*"|'[^']*'|\S+/g) ?? []).map((token) =>
        token.replace(/^(?:'|")|(?:'|")$/g, ""),
      );
      for (const token of tokens.slice(1).filter((item) => !item.startsWith("-"))) {
        if ((isAbsolute(token) || token.includes("/") || token.startsWith(".")) && token !== ".") {
          const key = repositoryPathKey(token, workspaceRoot);
          if (!key) throw new TraceNormalizationError("shell read target escapes repository");
        }
      }
      const gitSubcommand =
        executable === "git" ? tokens.find((token, index) => index > 0 && !token.startsWith("-")) : undefined;
      const kind =
        executable === "ls"
          ? "list"
          : executable === "rg" || executable === "grep" || executable === "find"
            ? "search"
            : executable === "cat" || executable === "sed" || executable === "head" || executable === "tail"
              ? "read"
              : executable === "wc"
                ? "read"
                : executable === "git" && gitSubcommand === "grep"
                  ? "search"
                  : executable === "git" && ["show", "diff", "log", "blame", "cat-file"].includes(gitSubcommand ?? "")
                    ? "read"
                    : executable === "git" && ["status", "ls-files"].includes(gitSubcommand ?? "")
                      ? "list"
                      : undefined;
      if (!kind && /\b(?:cat|sed|head|tail|rg|grep|find|ls)\b|\bgit\s+grep\b/.test(piece)) {
        throw new TraceNormalizationError("unsupported shell read form");
      }
      return kind ? [{ kind, key: normalizedCommandKey(piece, workspaceRoot) }] : [];
    });
}

function nativeToolKey(
  toolName: unknown,
  args: Record<string, unknown>,
  workspaceRoot: string,
):
  | {
      kind: "search" | "list";
      key: string;
    }
  | undefined {
  if (toolName !== "grep" && toolName !== "find" && toolName !== "list" && toolName !== "ls") return undefined;
  const kind = toolName === "list" || toolName === "ls" ? "list" : "search";
  const hasPath = typeof args.path === "string";
  const path = hasPath ? repositoryPathKey(args.path as string, workspaceRoot) : ".";
  if (hasPath && path === undefined) throw new TraceNormalizationError("native tool target escapes repository");
  const query = typeof args.pattern === "string" ? args.pattern : typeof args.query === "string" ? args.query : "";
  return { kind, key: `${toolName}:${query}:${path}` };
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new TraceNormalizationError(`${field} must be boolean`);
  return value;
}

export function normalizeEvaluationJsonl(
  jsonl: string,
  options: { workspaceRoot: string; maxEvents?: number; maxLineBytes?: number },
): NormalizedV2Trace {
  if (typeof jsonl !== "string") throw new TraceNormalizationError("trace must be JSONL text");
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  const lines = jsonl.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) throw new TraceNormalizationError("trace header is required");
  if (lines.length > maxEvents + 1) throw new TraceNormalizationError("trace event limit exceeded");
  const events: Record<string, unknown>[] = lines.map((line, index) => {
    if (Buffer.byteLength(line, "utf8") > maxLineBytes)
      throw new TraceNormalizationError("trace line byte limit exceeded");
    try {
      const parsed = JSON.parse(line) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not object");
      return parsed as Record<string, unknown>;
    } catch {
      throw new TraceNormalizationError(`malformed JSONL at line ${index + 1}`);
    }
  });
  const header = events.shift() as Record<string, unknown>;
  if (header.type !== "evaluation_trace" || header.schemaVersion !== 2 || header.sourceEvaluationVersion !== 2) {
    throw new TraceNormalizationError("supported V2 evaluation header is required");
  }
  const runId = opaque(header.runId, "runId");
  const taskId = opaque(header.taskId, "taskId");
  const interventions: V2Intervention[] = [];
  const materialCases: V2MaterialCase[] = [];
  const repositoryReadEvents: NormalizedReadEvent[] = [];
  const eventOrder: NormalizedEventOrder[] = [];
  let generatedSequence = 0;

  for (const event of events) {
    generatedSequence += 1;
    if (typeof event.schemaVersion === "number" && event.schemaVersion !== 2) {
      throw new TraceNormalizationError("unsupported event schema version");
    }
    if (event.type === "tool_execution_start") {
      const args =
        typeof event.args === "object" && event.args !== null && !Array.isArray(event.args)
          ? (event.args as Record<string, unknown>)
          : {};
      const operations: Array<{ kind: "read" | "search" | "list"; key: string }> = [];
      if (event.toolName === "read" && typeof args.path === "string") {
        const key = repositoryPathKey(args.path, options.workspaceRoot);
        if (!key) throw new TraceNormalizationError("native read target escapes repository");
        operations.push({ kind: "read", key });
      } else if (event.toolName === "bash" && typeof args.command === "string") {
        operations.push(...shellOperations(args.command, options.workspaceRoot));
      } else {
        const native = nativeToolKey(event.toolName, args, options.workspaceRoot);
        if (native) operations.push(native);
      }
      for (const { kind, key } of operations) {
        const id = `read-${repositoryReadEvents.length + 1}`;
        repositoryReadEvents.push({ id, kind, sequence: generatedSequence, keyDigest: digest(`${kind}:${key}`) });
        eventOrder.push({ id, kind, sequence: generatedSequence });
      }
      continue;
    }
    if (event.type === "evaluation_intervention") {
      const id = opaque(event.id, "intervention.id");
      const kind = event.kind as V2InterventionKind;
      const avoidable = AVOIDABLE_MAINTENANCE_KINDS.includes(kind as never);
      const necessary = NECESSARY_SAFETY_KINDS.includes(kind as never);
      if (!avoidable && !necessary) throw new TraceNormalizationError("unknown intervention kind");
      const sequence = integer(event.sequence, "intervention.sequence");
      interventions.push({ id, kind, sequence });
      eventOrder.push({ id, kind: avoidable ? "avoidable-maintenance" : "necessary-safety", sequence });
      continue;
    }
    if (event.type === "evaluation_material_case") {
      const id = opaque(event.id, "materialCase.id");
      const sequence = integer(event.sequence, "materialCase.sequence");
      materialCases.push({
        id,
        detectedBeforeContinuation: parseBoolean(event.detectedBeforeContinuation, "detectedBeforeContinuation"),
        resolvedAppendOnly: parseBoolean(event.resolvedAppendOnly, "resolvedAppendOnly"),
        falsePositive: parseBoolean(event.falsePositive, "falsePositive"),
      });
      eventOrder.push({ id, kind: "material-case", sequence });
    }
  }
  eventOrder.sort((left, right) => left.sequence - right.sequence);
  interventions.sort((left, right) => left.sequence - right.sequence);
  const normalized: NormalizedV2Trace = {
    schemaVersion: 2,
    sourceEvaluationVersion: 2,
    runId,
    taskId,
    taskScore:
      typeof header.taskScore === "number" && Number.isFinite(header.taskScore) && header.taskScore >= 0
        ? header.taskScore
        : (() => {
            throw new TraceNormalizationError("taskScore must be non-negative");
          })(),
    repositoryReads: repositoryReadEvents.length,
    resumedWithoutRestatement: parseBoolean(header.resumedWithoutRestatement, "resumedWithoutRestatement"),
    materialTaskCorrect: parseBoolean(header.materialTaskCorrect, "materialTaskCorrect"),
    interventions,
    materialCases,
    repositoryReadEvents,
    eventOrder,
    avoidableMaintenanceCount: interventions.filter((item) => AVOIDABLE_MAINTENANCE_KINDS.includes(item.kind as never))
      .length,
    necessarySafetyCount: interventions.filter((item) => NECESSARY_SAFETY_KINDS.includes(item.kind as never)).length,
    provenance: {
      normalizerVersion: 2,
      normalizerDigest: digest(jsonl),
      derivedDigest: "",
      harnessReceipt: {
        schemaVersion: 2,
        runId,
        taskId,
        parityDigest: "0".repeat(64),
        workspaceReceiptDigest: "0".repeat(64),
        normalizerDigest: digest(jsonl),
        derivedDigest: "0".repeat(64),
        materialCaseIds: materialCases.map((item) => item.id),
      },
      harnessReceiptDigest: "0".repeat(64),
    },
  };
  normalized.provenance.derivedDigest = computeV2DerivedTraceDigest(normalized);
  return normalized;
}
