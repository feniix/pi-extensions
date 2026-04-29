import { truncateUtf8 } from "./artifact-content.js";
import type { ConductorEvent, RunAttemptRecord } from "./types.js";

function terminalSummaryPreview(value: string | null): { text: string | null; truncated: boolean } {
  if (!value) return { text: null, truncated: false };
  const preview = truncateUtf8(value, 1000);
  return { text: preview.content, truncated: preview.truncated };
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
  if (error.text) {
    lines.push(
      `Error: ${error.text}${error.truncated ? " (truncated; inspect run details or artifacts for full output)" : ""}`,
    );
  }
  if (completion.text) {
    lines.push(
      `Completion summary: ${completion.text}${completion.truncated ? " (truncated; inspect run details or artifacts for full output)" : ""}`,
    );
  }
  if (!error.text && !completion.text) lines.push("Completion summary: none");
  return lines.join("\n");
}
