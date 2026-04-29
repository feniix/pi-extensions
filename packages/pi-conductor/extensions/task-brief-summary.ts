import { truncateUtf8 } from "./artifact-content.js";
import type { ConductorEvent, RunAttemptRecord } from "./types.js";

function terminalSummaryPreview(value: string | null): { text: string | null; truncated: boolean } {
  if (!value) return { text: null, truncated: false };
  const preview = truncateUtf8(value, 1000);
  return { text: preview.content, truncated: preview.truncated };
}

function terminalFieldMarkdown(label: string, preview: { text: string | null; truncated: boolean }): string | null {
  if (!preview.text) return null;
  const suffix = preview.truncated ? " (truncated; inspect run details or artifacts for full output)" : "";
  const normalizedText = preview.text.replace(/\r\n?/g, "\n");
  if (!normalizedText.includes("\n")) return `${label}: ${normalizedText}${suffix}`;
  const indented = normalizedText
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
  return `${label}:${suffix}\n${indented}`;
}

export function terminalRunSummaryMarkdown(run: RunAttemptRecord | null, events: ConductorEvent[]): string {
  if (!run) return "- none";
  const completedEvent = [...events]
    .reverse()
    .find((event) => event.type === "run.completed" && event.resourceRefs.runId === run.runId);
  const eventSummary =
    typeof completedEvent?.payload.completionSummary === "string" ? completedEvent.payload.completionSummary : null;
  const eventError =
    typeof completedEvent?.payload.errorMessage === "string" ? completedEvent.payload.errorMessage : null;
  const completion = terminalSummaryPreview(run.completionSummary ?? eventSummary);
  const error = terminalSummaryPreview(run.errorMessage ?? eventError);
  const lines = [`Run: ${run.runId} status=${run.status}`];
  const errorMarkdown = terminalFieldMarkdown("Error", error);
  const completionMarkdown = terminalFieldMarkdown("Completion summary", completion);
  if (errorMarkdown) lines.push(errorMarkdown);
  if (completionMarkdown) lines.push(completionMarkdown);
  if (!errorMarkdown && !completionMarkdown) lines.push("Completion summary: none");
  return lines.join("\n");
}
