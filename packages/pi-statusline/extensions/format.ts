import { defaultPalette } from "./palette.js";
import type { MinimalModel, StatuslineLinesInput, StatuslinePalette } from "./types.js";

type SegmentColor = keyof StatuslinePalette;

type StyledSegment = {
  text: string;
  color: SegmentColor;
};

const ANSI_RESET = "\u001B[0m";

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

export function stripAnsi(text: string): string {
  return text.replace(/\u001B\[[0-9;]*m/g, "");
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace(/^#/, "");
  const value = Number.parseInt(normalized, 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

export function colorize(text: string, color: SegmentColor, palette: StatuslinePalette = defaultPalette): string {
  const [r, g, b] = hexToRgb(palette[color]);
  return `\u001B[38;2;${r};${g};${b}m${text}${ANSI_RESET}`;
}

function truncatePlainText(text: string, width: number): string {
  if (width <= 0 || text.length <= width) {
    return text;
  }
  if (width <= 3) {
    return ".".repeat(width);
  }
  return `${text.slice(0, width - 3)}...`;
}

function buildStyledLine(segments: StyledSegment[], width?: number, palette: StatuslinePalette = defaultPalette): string {
  if (width !== undefined && width <= 0) {
    return "";
  }

  const rendered: string[] = [];
  let usedWidth = 0;

  for (const [index, segment] of segments.entries()) {
    const isFirst = index === 0;
    const separator = isFirst ? "" : " | ";
    const separatorWidth = separator.length;
    const segmentWidth = segment.text.length;

    if (width === undefined) {
      if (!isFirst) {
        rendered.push(colorize(separator, "separators", palette));
      }
      rendered.push(colorize(segment.text, segment.color, palette));
      continue;
    }

    const availableWidth = width - usedWidth;
    if (availableWidth <= 0) {
      break;
    }

    if (!isFirst) {
      if (availableWidth < separatorWidth) {
        rendered.push(truncatePlainText(separator, availableWidth));
        break;
      }
      rendered.push(colorize(separator, "separators", palette));
      usedWidth += separatorWidth;
    }

    const segmentAvailableWidth = width - usedWidth;
    if (segmentAvailableWidth <= 0) {
      break;
    }

    const needsTruncation = segmentWidth > segmentAvailableWidth;
    const nextText = needsTruncation ? truncatePlainText(segment.text, segmentAvailableWidth) : segment.text;
    rendered.push(colorize(nextText, segment.color, palette));
    usedWidth += nextText.length;

    if (needsTruncation) {
      break;
    }
  }

  return rendered.join("");
}

export function buildStatusLines(input: StatuslineLinesInput, width?: number, palette: StatuslinePalette = defaultPalette): string[] {
  const line1 = buildStyledLine(
    [
      { text: input.modelLabel, color: "model" },
      { text: input.thinkingLabel, color: "thinking" },
      { text: input.contextLabel, color: "context" },
      { text: input.branchLabel, color: "branch" },
      { text: input.dirtyLabel, color: "dirty" },
      { text: input.tokenLabel, color: "token" },
    ],
    width,
    palette,
  );

  const line2 = buildStyledLine(
    [
      { text: input.repoLabel, color: "repo" },
      { text: input.cwdLabel, color: "cwd" },
      { text: input.worktreeLabel, color: "worktree" },
      { text: input.skillLabel, color: "skill" },
      { text: input.activityLabel, color: "activity" },
    ],
    width,
    palette,
  );

  return [line1, line2];
}
