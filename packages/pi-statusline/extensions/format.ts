import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import {
  getTerminalColorMode,
  parseColor,
  stripTerminalSequences,
  styleText,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { defaultPalette } from "./palette.js";
import type { MinimalModel, StatuslineLinesInput, StatuslinePalette } from "./types.js";

type SegmentColor = keyof StatuslinePalette;

type StyledSegment = {
  text: string;
  color?: SegmentColor;
};

export type StatuslineTheme = Pick<Theme, "style">;
const themeColors: Record<SegmentColor, ThemeColor> = {
  background: "text",
  model: "accent",
  repo: "accent",
  thinking: "thinkingText",
  skill: "accent",
  context: "muted",
  branch: "text",
  dirty: "warning",
  token: "dim",
  separators: "dim",
  cwd: "muted",
  worktree: "accent",
  activity: "success",
};

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
  return stripTerminalSequences(text);
}

export function colorize(
  text: string,
  color: SegmentColor,
  palette: Partial<StatuslinePalette> = {},
  theme?: StatuslineTheme,
): string {
  const override = palette[color];
  if (theme) {
    return theme.style(text, { fg: override ? parseColor(override) : themeColors[color] });
  }
  return styleText(text, { fg: parseColor(override ?? defaultPalette[color]) }, getTerminalColorMode());
}

function truncatePlainText(text: string, width: number): string {
  return truncateToWidth(text, width, width <= 3 ? ".".repeat(Math.max(0, width)) : "...");
}

function buildStyledLine(
  segments: StyledSegment[],
  width?: number,
  palette: Partial<StatuslinePalette> = {},
  theme?: StatuslineTheme,
): string {
  if (width !== undefined && width <= 0) {
    return "";
  }

  const rendered: string[] = [];
  let usedWidth = 0;

  for (const [index, segment] of segments.entries()) {
    const isFirst = index === 0;
    const separator = isFirst ? "" : " | ";
    const separatorWidth = separator.length;
    const segmentWidth = visibleWidth(segment.text);

    if (width === undefined) {
      if (!isFirst) {
        rendered.push(colorize(separator, "separators", palette, theme));
      }
      rendered.push(segment.color ? colorize(segment.text, segment.color, palette, theme) : segment.text);
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
      rendered.push(colorize(separator, "separators", palette, theme));
      usedWidth += separatorWidth;
    }

    const segmentAvailableWidth = width - usedWidth;
    if (segmentAvailableWidth <= 0) {
      break;
    }

    const needsTruncation = segmentWidth > segmentAvailableWidth;
    const nextText = needsTruncation ? truncatePlainText(segment.text, segmentAvailableWidth) : segment.text;
    rendered.push(segment.color ? colorize(nextText, segment.color, palette, theme) : nextText);
    usedWidth += visibleWidth(nextText);

    if (needsTruncation) {
      break;
    }
  }

  return rendered.join("");
}

export function buildStatusLines(
  input: StatuslineLinesInput,
  width?: number,
  palette: Partial<StatuslinePalette> = {},
  theme?: StatuslineTheme,
): string[] {
  const firstSegments: StyledSegment[] = [
    { text: input.modelLabel, color: "model" },
    { text: input.thinkingLabel, color: "thinking" },
    { text: input.contextLabel, color: "context" },
    { text: input.branchLabel, color: "branch" },
    { text: input.dirtyLabel, color: "dirty" },
    { text: input.tokenLabel, color: "token" },
  ];
  const statusSegments: StyledSegment[] = (input.extensionStatuses ?? []).map((text) => ({ text }));
  const secondSegments: StyledSegment[] = [
    { text: input.repoLabel, color: "repo" },
    { text: input.cwdLabel, color: "cwd" },
    { text: input.worktreeLabel, color: "worktree" },
    { text: input.skillLabel, color: "skill" },
    { text: input.activityLabel, color: "activity" },
    ...statusSegments,
  ];
  const fits = (segments: StyledSegment[]) =>
    width === undefined || visibleWidth(segments.map(({ text }) => text).join(" | ")) <= width;
  const line1 = buildStyledLine(
    fits(firstSegments)
      ? firstSegments
      : [...firstSegments.slice(2, 3), ...firstSegments.slice(0, 2), ...firstSegments.slice(3)],
    width,
    palette,
    theme,
  );
  const line2 = buildStyledLine(
    fits(secondSegments)
      ? secondSegments
      : [...secondSegments.slice(4, 5), ...statusSegments, ...secondSegments.slice(0, 4)],
    width,
    palette,
    theme,
  );

  return [line1, line2];
}
