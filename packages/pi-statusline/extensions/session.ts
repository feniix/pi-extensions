import { formatCompactNumber, formatModelLabel, formatTokenPair } from "./format.js";
import type { AssistantUsageLike, ContextUsageLike, MinimalModel, SessionEntryLike, TokenTotals } from "./types.js";

export function getTokenTotals(
  entries: ReadonlyArray<SessionEntryLike>,
  liveAssistantUsage?: AssistantUsageLike | null,
): TokenTotals {
  let input = 0;
  let output = 0;

  for (const entry of entries) {
    if (entry.type !== "message" || entry.message?.role !== "assistant") {
      continue;
    }

    input += entry.message.usage?.input ?? 0;
    output += entry.message.usage?.output ?? 0;
  }

  if (!liveAssistantUsage) {
    return { input, output };
  }

  const lastEntry = entries.at(-1);
  const liveInput = liveAssistantUsage.input ?? 0;
  const liveOutput = liveAssistantUsage.output ?? 0;

  if (lastEntry?.type === "message" && lastEntry.message?.role === "assistant") {
    input -= lastEntry.message.usage?.input ?? 0;
    output -= lastEntry.message.usage?.output ?? 0;
  }

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
