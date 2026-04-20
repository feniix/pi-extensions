/**
 * Exa Extension Formatters
 */

import type { CrawlResult, SearchResult } from "./types.js";

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No search results found. Please try a different query.";
  }

  return results
    .map((r) => {
      const lines: string[] = [
        `Title: ${r.title || "N/A"}`,
        `URL: ${r.url}`,
        `Published: ${r.publishedDate || "N/A"}`,
        `Author: ${r.author || "N/A"}`,
      ];
      if (Array.isArray(r.highlights) && r.highlights.length > 0) {
        lines.push(`Highlights:\n${r.highlights.join("\n")}`);
      } else if (r.text) {
        lines.push(`Text: ${r.text}`);
      }
      return lines.join("\n");
    })
    .join("\n\n---\n\n");
}

export function formatCrawlResults(results: CrawlResult[]): string {
  if (results.length === 0) {
    return "No content found.";
  }

  return results
    .map((r) => {
      const lines: string[] = [`# ${r.title || "(no title)"}`, `URL: ${r.url}`];
      if (r.publishedDate) {
        lines.push(`Published: ${r.publishedDate.split("T")[0]}`);
      }
      if (r.author) {
        lines.push(`Author: ${r.author}`);
      }
      lines.push("");
      if (r.text) {
        lines.push(r.text);
      }
      lines.push("");
      return lines.join("\n");
    })
    .join("\n");
}
