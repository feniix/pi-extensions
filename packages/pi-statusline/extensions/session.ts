import { formatCompactNumber, formatModelLabel, formatTokenPair } from "./format.js";
import type {
  AssistantUsageLike,
  ContextUsageLike,
  MinimalModel,
  SessionEntryLike,
  TokenTotals,
  UsageTotals,
} from "./types.js";

function addUsage(totals: UsageTotals, usage?: AssistantUsageLike) {
  totals.input += usage?.input ?? 0;
  totals.output += usage?.output ?? 0;
  totals.cacheRead += usage?.cacheRead ?? 0;
  totals.cacheWrite += usage?.cacheWrite ?? 0;
  totals.cost += usage?.cost?.total ?? 0;
}

export function getUsageTotals(entries: ReadonlyArray<SessionEntryLike>): UsageTotals {
  const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  for (const entry of entries) {
    if (entry.type === "message" && (entry.message?.role === "assistant" || entry.message?.role === "toolResult")) {
      addUsage(totals, entry.message.usage);
    } else if (entry.type === "usage" || entry.type === "compaction" || entry.type === "branch_summary") {
      addUsage(totals, entry.usage);
    }
  }
  return totals;
}

export function formatUsageLabel(
  totals: UsageTotals,
  options: { showCost?: boolean; showCache?: boolean } = {},
): string {
  const parts = [formatTokenPair(totals.input, totals.output)];
  if (options.showCache) {
    parts.push(`R${formatCompactNumber(totals.cacheRead)}`, `W${formatCompactNumber(totals.cacheWrite)}`);
  }
  if (options.showCost) parts.push(`$${totals.cost.toFixed(3)}`);
  return parts.join(" ");
}

type UsageMessage = NonNullable<SessionEntryLike["message"]>;
type UsageManager = {
  getBranch(): ReadonlyArray<SessionEntryLike>;
  getLeafId(): string | null;
  getSessionId(): string;
};

/** Cache branch accounting; message_end fires before persistence, so retain uncommitted results. */
export function createUsageTracker() {
  let cachedManager: UsageManager | undefined;
  let cachedSession: string | undefined;
  let cachedLeaf: string | null | undefined;
  let totals = getUsageTotals([]);
  let persistedMessages = new Set<UsageMessage>();
  let live: UsageMessage | undefined;
  const pending = new Map<UsageMessage, AssistantUsageLike>();
  const invalidate = () => {
    cachedManager = undefined;
  };
  return {
    invalidate,
    clear() {
      invalidate();
      pending.clear();
      live = undefined;
    },
    update(message: UsageMessage) {
      if (message.role === "assistant") live = message;
    },
    finish(message: UsageMessage) {
      if ((message.role === "assistant" || message.role === "toolResult") && message.usage) {
        pending.set(message, message.usage);
      }
      if (message.role === "assistant") live = undefined;
      invalidate();
    },
    read(manager: UsageManager): UsageTotals {
      const sessionId = manager.getSessionId();
      const leafId = manager.getLeafId();
      if (cachedManager !== manager || cachedSession !== sessionId || cachedLeaf !== leafId) {
        const entries = manager.getBranch();
        totals = getUsageTotals(entries);
        persistedMessages = new Set(entries.flatMap((entry) => (entry.message ? [entry.message] : [])));
        for (const message of pending.keys()) {
          if (persistedMessages.has(message)) pending.delete(message);
        }
        cachedManager = manager;
        cachedSession = sessionId;
        cachedLeaf = leafId;
      }
      const result = { ...totals };
      for (const usage of pending.values()) addUsage(result, usage);
      if (live && !persistedMessages.has(live)) addUsage(result, live.usage);
      return result;
    },
  };
}

export function getTokenTotals(
  entries: ReadonlyArray<SessionEntryLike>,
  liveAssistantUsage?: AssistantUsageLike | null,
): TokenTotals {
  let { input, output } = getUsageTotals(entries);

  if (!liveAssistantUsage) {
    return { input, output };
  }

  const liveInput = liveAssistantUsage.input ?? 0;
  const liveOutput = liveAssistantUsage.output ?? 0;

  input += liveInput;
  output += liveOutput;

  return { input, output };
}

export function getTokenLabel(
  entries: ReadonlyArray<SessionEntryLike>,
  liveAssistantUsage?: AssistantUsageLike | null,
): string {
  const totals = getTokenTotals(entries, liveAssistantUsage);
  return formatTokenPair(totals.input, totals.output);
}

export function getThinkingLabel(thinkingLevel?: string): string {
  return `Thinking: ${thinkingLevel || "off"}`;
}

export function getContextLabel(contextUsage: ContextUsageLike | undefined, model?: MinimalModel): string {
  const percent = contextUsage?.percent;
  if (typeof percent === "number" && Number.isFinite(percent)) {
    return `Ctx: ${percent.toFixed(1)}%`;
  }

  const tokens = contextUsage?.tokens;
  const contextWindow = contextUsage?.contextWindow ?? model?.contextWindow;
  if (typeof tokens === "number" && Number.isFinite(tokens) && contextWindow && contextWindow > 0) {
    const computedPercent = (tokens / contextWindow) * 100;
    return `Ctx: ${computedPercent.toFixed(1)}%`;
  }

  return "Ctx: n/a";
}

export function getModelLabel(model?: MinimalModel): string {
  return formatModelLabel(model);
}

export function getRepoFallbackLabel(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter((part) => part.length > 0);
  return parts.at(-1) || cwd || "cwd";
}

export function getCwdLabel(cwd: string): string {
  return `cwd: ${cwd || "n/a"}`;
}

export function formatContextWindowSummary(model?: MinimalModel): string {
  const contextWindow = model?.contextWindow;
  if (!contextWindow || contextWindow <= 0) {
    return "none";
  }
  return formatCompactNumber(contextWindow);
}
