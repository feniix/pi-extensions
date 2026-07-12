/**
 * TUI renderers for Exa tools in pi's interactive mode.
 *
 * This file imports `@earendil-works/pi-tui` and is only loaded by the pi
 * extension entry point (`index.ts`). It must never be imported by the MCP
 * server entry point (`mcp-server.ts`) so that MCP consumers do not need
 * `pi-tui` installed.
 */

import { Text } from "@earendil-works/pi-tui";

const MAX_EXPANDED_CHARS = 8000;
const MAX_COLLAPSED_CHARS = 300;
const MAX_COLLAPSED_LINES = 8;

// Exa result text is built from web-page content (titles, URLs, bodies), so it
// can carry ANSI/OSC escape sequences and other control bytes. pi's default
// tool renderer strips these before display; these custom renderers replace
// that path and must neutralize them themselves — otherwise a malicious page
// could inject escapes to spoof the terminal review surface. Mirrors the
// `stripAnsi` + `sanitizeBinaryOutput` step in pi-coding-agent's render-utils.
//
// Stripping control codes is the whole point of these two patterns. They use
// RegExp(string) with ASCII escapes (not raw bytes) so the source can't be
// corrupted by tooling; useRegexLiterals is suppressed for the same reason.
// biome-ignore lint/complexity/useRegexLiterals: string form keeps control-char classes as ASCII escapes, not raw bytes
const ANSI_PATTERN = new RegExp(
  "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d/#&.:=?%@~_]*)*)?\\u0007)|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))",
  "g",
);
// Strip remaining C0 (except \t and \n) plus C1/DEL control bytes; \r is dropped too.
// biome-ignore lint/complexity/useRegexLiterals: string form keeps the control-char class as ASCII escapes, not raw bytes
const CONTROL_PATTERN = new RegExp("[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F]", "g");

function sanitizeForDisplay(text: string): string {
  return text.replace(ANSI_PATTERN, "").replace(CONTROL_PATTERN, "");
}

function getTextContent(result: { content?: Array<{ type: string; text?: string }> }): string {
  return sanitizeForDisplay(result.content?.map((c) => (c.type === "text" ? c.text : "")).join("\n") ?? "");
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n… (truncated, ${text.length - maxChars} more chars)`;
}

function formatCollapsed(
  text: string,
  maxLines: number = MAX_COLLAPSED_LINES,
  maxChars: number = MAX_COLLAPSED_CHARS,
): string {
  const truncated = text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
  const lines = truncated.split("\n");
  if (lines.length <= maxLines) return truncated;
  return `${lines.slice(0, maxLines).join("\n")}\n… (${lines.length - maxLines} more lines)`;
}

function extractResultLines(text: string, prefix: string, maxItems: number = 5): string[] {
  const lines = text.split("\n");
  const items: string[] = [];
  let currentItem = "";
  for (const line of lines) {
    if (line.startsWith(prefix)) {
      if (currentItem) items.push(currentItem.trim());
      currentItem = line;
    } else if (currentItem) {
      currentItem += `\n${line}`;
    }
  }
  if (currentItem) items.push(currentItem.trim());
  return items.slice(0, maxItems);
}

function makeSearchCollapsed(text: string): string {
  // Extract Title: lines and show first 5 with ▸ bullet
  const titles = extractResultLines(text, "Title:", 5);
  if (titles.length === 0) {
    return formatCollapsed(text);
  }
  const lines = titles.map((t) => {
    const titleMatch = t.match(/^Title:\s*(.+)$/m);
    const urlMatch = t.match(/^URL:\s*(.+)$/m);
    const title = titleMatch?.[1] ?? "N/A";
    const url = urlMatch?.[1] ?? "";
    return `▸ ${title}${url ? ` — ${url}` : ""}`;
  });
  return `${lines.join("\n")}\nctrl+o → expand`;
}

function makeFetchCollapsed(text: string): string {
  const titleMatch = text.match(/^#\s*(.+)$/m);
  const urlMatch = text.match(/^URL:\s*(.+)$/m);
  if (!titleMatch && !urlMatch) {
    return `${formatCollapsed(text)}\nctrl+o → expand`;
  }
  const title = titleMatch?.[1] ?? "(no title)";
  const url = urlMatch?.[1] ?? "";
  let out = `# ${title}`;
  if (url) out += `\nURL: ${url}`;
  return `${out}\nctrl+o → expand`;
}

// =============================================================================
// renderCall factories
// =============================================================================

// biome-ignore-start lint/suspicious/noExplicitAny: renderer callback shape matches pi host contract
function renderSearchCall(toolName: string) {
  return (args: any, theme: any, context: any) => {
    const text = context.lastComponent ?? new Text("", 0, 0);
    const query = sanitizeForDisplay(args.query ?? "");
    const num = args.numResults ?? "";
    const numStr = num ? ` (${num} results)` : "";
    text.setText(`${theme.fg("toolTitle", theme.bold(`${toolName} `))} "${query}"${numStr}`);
    return text;
  };
}

function renderFetchCall(toolName: string) {
  return (args: any, theme: any, context: any) => {
    const text = context.lastComponent ?? new Text("", 0, 0);
    const urls: string[] = args.urls ?? [];
    const countStr = urls.length > 0 ? `${urls.length} URL(s)` : "0 URL(s)";
    text.setText(`${theme.fg("toolTitle", theme.bold(`${toolName} `))} ${countStr}`);
    return text;
  };
}

function renderAnswerCall(toolName: string) {
  return (args: any, theme: any, context: any) => {
    const text = context.lastComponent ?? new Text("", 0, 0);
    const query = sanitizeForDisplay(args.query ?? "");
    text.setText(`${theme.fg("toolTitle", theme.bold(`${toolName} `))} "${query}"`);
    return text;
  };
}

function renderSimilarCall(toolName: string) {
  return (args: any, theme: any, context: any) => {
    const text = context.lastComponent ?? new Text("", 0, 0);
    const url = sanitizeForDisplay(args.url ?? "");
    const num = args.numResults ?? "";
    const numStr = num ? ` (${num} results)` : "";
    text.setText(`${theme.fg("toolTitle", theme.bold(`${toolName} `))} ${url}${numStr}`);
    return text;
  };
}

function renderResearchCall(toolName: string) {
  return (args: any, theme: any, context: any) => {
    const text = context.lastComponent ?? new Text("", 0, 0);
    const query = sanitizeForDisplay(args.query ?? "");
    const type = sanitizeForDisplay(args.type ?? "");
    const typeStr = type ? ` [${type}]` : "";
    text.setText(`${theme.fg("toolTitle", theme.bold(`${toolName} `))} "${query}"${typeStr}`);
    return text;
  };
}

function renderAdvancedSearchCall(toolName: string) {
  return (args: any, theme: any, context: any) => {
    const text = context.lastComponent ?? new Text("", 0, 0);
    const query = sanitizeForDisplay(args.query ?? "");
    const filters: string[] = [];
    if (args.category) filters.push(`cat:${sanitizeForDisplay(String(args.category))}`);
    if (args.includeDomains?.length) filters.push(`domains:${args.includeDomains.length}`);
    if (args.startPublishedDate || args.endPublishedDate) filters.push("date");
    const filterStr = filters.length ? ` (${filters.join(", ")})` : "";
    text.setText(`${theme.fg("toolTitle", theme.bold(`${toolName} `))} "${query}"${filterStr}`);
    return text;
  };
}
// biome-ignore-end lint/suspicious/noExplicitAny: renderer callback shape matches pi host contract

// =============================================================================
// renderResult factories
// =============================================================================

// biome-ignore-start lint/suspicious/noExplicitAny: renderer callback shape matches pi host contract
function renderSearchResult() {
  return (result: any, options: any, _theme: any, context: any) => {
    const text = context.lastComponent ?? new Text("", 0, 0);
    const fullText = getTextContent(result);
    if (options.expanded) {
      text.setText(truncateText(fullText, MAX_EXPANDED_CHARS));
    } else {
      text.setText(makeSearchCollapsed(fullText));
    }
    return text;
  };
}

function renderFetchResult() {
  return (result: any, options: any, _theme: any, context: any) => {
    const text = context.lastComponent ?? new Text("", 0, 0);
    const fullText = getTextContent(result);
    if (options.expanded) {
      text.setText(truncateText(fullText, MAX_EXPANDED_CHARS));
    } else {
      text.setText(makeFetchCollapsed(fullText));
    }
    return text;
  };
}

function renderAnswerResult() {
  return (result: any, options: any, theme: any, context: any) => {
    const text = context.lastComponent ?? new Text("", 0, 0);
    const fullText = getTextContent(result);
    if (options.expanded) {
      text.setText(truncateText(fullText, MAX_EXPANDED_CHARS));
    } else {
      text.setText(`${formatCollapsed(fullText, 4, 200)}\n${theme.fg("dim", "ctrl+o → expand")}`);
    }
    return text;
  };
}

function renderResearchResult() {
  return (result: any, options: any, theme: any, context: any) => {
    const text = context.lastComponent ?? new Text("", 0, 0);
    const fullText = getTextContent(result);
    if (options.expanded) {
      text.setText(truncateText(fullText, MAX_EXPANDED_CHARS));
    } else {
      text.setText(`${formatCollapsed(fullText, 5, 300)}\n${theme.fg("dim", "ctrl+o → expand")}`);
    }
    return text;
  };
}
// biome-ignore-end lint/suspicious/noExplicitAny: renderer callback shape matches pi host contract

// =============================================================================
// Registry
// =============================================================================

// biome-ignore-start lint/suspicious/noExplicitAny: renderer callback shape matches pi host contract
export interface ExaRenderers {
  renderCall?: (args: any, theme: any, context: any) => any;
  renderResult?: (result: any, options: any, theme: any, context: any) => any;
}
// biome-ignore-end lint/suspicious/noExplicitAny: renderer callback shape matches pi host contract

export function getExaRenderers(toolName: string): ExaRenderers {
  switch (toolName) {
    case "web_search_exa":
      return {
        renderCall: renderSearchCall("web_search_exa"),
        renderResult: renderSearchResult(),
      };
    case "web_fetch_exa":
      return {
        renderCall: renderFetchCall("web_fetch_exa"),
        renderResult: renderFetchResult(),
      };
    case "web_answer_exa":
      return {
        renderCall: renderAnswerCall("web_answer_exa"),
        renderResult: renderAnswerResult(),
      };
    case "web_find_similar_exa":
      return {
        renderCall: renderSimilarCall("web_find_similar_exa"),
        renderResult: renderSearchResult(),
      };
    case "web_research_exa":
      return {
        renderCall: renderResearchCall("web_research_exa"),
        renderResult: renderResearchResult(),
      };
    case "web_search_advanced_exa":
      return {
        renderCall: renderAdvancedSearchCall("web_search_advanced_exa"),
        renderResult: renderSearchResult(),
      };
    default:
      return {};
  }
}
