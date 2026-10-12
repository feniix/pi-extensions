/**
 * Scripted model for the #175 guided smoke. It is loaded next to the real
 * pi-exa extension in a real `pi --mode rpc` process and reacts to the actual
 * tool results like a guided assistant should: start the cycle, record the
 * brief, present the proposal, submit against the proposalId, acknowledge the
 * run ID, chat while the job runs, and report when the completion notice lands.
 * It never writes approvals; the host dialog does.
 */

import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TOPIC = "Laya versus Jev for small structured decisions";

export function scriptedGuidedResponses(count = 60) {
  const step = (context: { messages: Array<{ role: string; content: unknown }> }) => {
    const last = context.messages.at(-1);
    const text = JSON.stringify(last?.content ?? "");
    if (text.includes("reached a terminal state")) {
      return fauxAssistantMessage(fauxToolCall("exa_research_status", {}), { stopReason: "toolUse" });
    }
    if (last?.role === "toolResult" && text.includes("finalReport")) {
      return fauxAssistantMessage(
        "Report: the research finished. Findings, recorded gaps, assumptions and classified usage follow from the final report; nothing further was submitted.",
      );
    }
    if (last?.role === "user" && /"text":"research laya/i.test(text)) {
      return fauxAssistantMessage(fauxToolCall("exa_research_status", { action: "start", topic: TOPIC }), {
        stopReason: "toolUse",
      });
    }
    if (last?.role === "toolResult" && text.includes("Guided draft created without spending")) {
      return fauxAssistantMessage(
        fauxToolCall("exa_research_step", {
          topic: TOPIC,
          stage: "framing",
          note: "User wants a decision-oriented comparison grounded in public docs.",
          thought_number: 1,
          total_thoughts: 1,
          next_step_needed: false,
          criteria: [
            { id: "C1", label: "Calibration on classification tasks", status: "proposed" },
            { id: "C2", label: "Cost per decision", status: "proposed" },
          ],
          assumptions: ["Only public documentation and pricing pages count as evidence."],
          gaps: [
            {
              id: "G1",
              description: "No latency benchmarks collected yet",
              severity: "important",
              resolution: "carry_assumption",
            },
          ],
          executionPlan: {
            goal: "Compare Laya and Jev for small structured decisions",
            scope: ["public documentation", "pricing pages"],
            constraints: ["exclude marketing claims"],
            taskSchema: {
              $schema: "http://json-schema.org/draft-07/schema#",
              type: "object",
              properties: { summary: { type: "string" } },
              required: ["summary"],
            },
            controls: { effort: "medium" },
          },
        }),
        { stopReason: "toolUse" },
      );
    }
    if (last?.role === "toolResult" && text.includes("stepCount") && text.includes("criteriaCoverage")) {
      return fauxAssistantMessage(fauxToolCall("exa_research_summary", { mode: "proposal" }), {
        stopReason: "toolUse",
      });
    }
    if (last?.role === "toolResult" && text.includes("Research proposal ")) {
      const match = /Research proposal ([0-9a-f]{16}) \(cycle ([0-9a-f-]{36})/.exec(text.replace(/\\n/g, "\n"));
      return fauxAssistantMessage(
        fauxToolCall("web_research_exa", {
          researchMode: "submit",
          cycleId: match?.[2] ?? "missing",
          proposalId: match?.[1] ?? "missing",
        }),
        { stopReason: "toolUse" },
      );
    }
    if (last?.role === "toolResult" && text.includes("Research started: Exa run")) {
      return fauxAssistantMessage(
        "Research started. I registered background monitoring and will report when it finishes; feel free to keep chatting.",
      );
    }
    if (last?.role === "toolResult") {
      return fauxAssistantMessage(`The research tool reported a pause: ${text.slice(0, 200)}`);
    }
    return fauxAssistantMessage(
      process.env.EXA_SMOKE_LONG_REPLY === "1"
        ? `Sure, we can talk about something else while it runs. ${"Here is a long digression that keeps the assistant streaming for a while. ".repeat(30)}`
        : "Sure, we can talk about something else while it runs.",
    );
  };
  return Array.from({ length: count }, () => step);
}

export default function guidedSmokeModel(pi: ExtensionAPI) {
  const tokensPerSecond = Number(process.env.EXA_SMOKE_TOKENS_PER_SECOND);
  const faux = fauxProvider({
    provider: "exa-smoke",
    models: [{ id: "scripted" }],
    ...(Number.isFinite(tokensPerSecond) && tokensPerSecond > 0 ? { tokensPerSecond } : {}),
  });
  faux.setResponses(scriptedGuidedResponses() as never);
  pi.registerProvider(faux.provider);
}
