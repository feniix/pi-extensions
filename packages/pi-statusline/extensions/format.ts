import type { MinimalModel, StatuslineLinesInput } from "./types.js";

export function formatCompactNumber(value: number): string {
  const absValue = Math.abs(value);
  if (absValue >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (absValue >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return String(value);
}

export function formatTokenPair(input: number, output: number): string {
  return `↑${formatCompactNumber(input)}/↓${formatCompactNumber(output)}`;
}

export function formatContextWindow(contextWindow?: number): string | null {
  if (!contextWindow || contextWindow <= 0) {
    return null;
  }
  return `${formatCompactNumber(contextWindow)} context`;
}

export function formatModelLabel(model?: MinimalModel): string {
  if (!model) {
    return "Model: none";
  }

  const baseName = model.name?.trim() || model.id?.trim() || "none";
  const contextSuffix = formatContextWindow(model.contextWindow);
  return contextSuffix ? `Model: ${baseName} (${contextSuffix})` : `Model: ${baseName}`;
}

export function joinSegments(segments: string[]): string {
  return segments.join(" | ");
}

export function truncateLine(line: string, width: number): string {
  if (width <= 0 || line.length <= width) {
    return line;
  }
  if (width <= 3) {
    return ".".repeat(width);
  }
  return `${line.slice(0, width - 3)}...`;
}

export function buildStatusLines(input: StatuslineLinesInput, width?: number): string[] {
  const line1 = joinSegments([
    input.modelLabel,
    input.thinkingLabel,
    input.contextLabel,
    input.branchLabel,
    input.dirtyLabel,
    input.tokenLabel,
  ]);
  const line2 = joinSegments([input.repoLabel, input.cwdLabel, input.worktreeLabel, input.skillLabel]);

  if (width === undefined) {
    return [line1, line2];
  }

  return [truncateLine(line1, width), truncateLine(line2, width)];
}
