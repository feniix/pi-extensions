/**
 * Loadable entry for the #171 prototype:
 *
 *   pi -e packages/pi-exa/__tests__/fixtures/guided-prototype/pi-entry.ts
 *
 * With your own model, ask for research; the assistant should call
 * exa_proto_research propose → submit, you approve in the dialog, then drive the
 * mocked job with `/exa-proto complete <run-id>` while you keep chatting.
 *
 * Set EXA_PROTO_SCRIPTED=1 to also register the scripted `exa-proto/scripted`
 * model (used by the RPC regression) and EXA_PROTO_BOUNDS to a JSON object to
 * override monitor bounds.
 */

import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createMockExa } from "./mock-exa.js";
import { createGuidedPrototype, type MonitorBounds } from "./prototype.js";

/**
 * Reactive scripted model: it reads the last transcript message and answers the
 * way a guided assistant should, so the same script works across sessions.
 */
export function scriptedResponses(count = 40) {
  const step = (context: { messages: Array<{ role: string; content: unknown }> }) => {
    const last = context.messages.at(-1);
    const text = JSON.stringify(last?.content ?? "");
    // Completion notices reach the model as ordinary context, so test their content first.
    if (text.includes("reached a terminal state")) {
      return fauxAssistantMessage("The research finished. Here is the report with findings, sources, gaps and usage.");
    }
    if (last?.role === "user" && /"text":"research laya/i.test(text)) {
      return fauxAssistantMessage(fauxToolCall("exa_proto_research", { action: "propose", topic: "Laya versus Jev" }), {
        stopReason: "toolUse",
      });
    }
    if (last?.role === "toolResult" && text.includes("Research proposal r")) {
      const proposalId = /\(([0-9a-f]{16})\)/.exec(text)?.[1] ?? "missing";
      return fauxAssistantMessage(fauxToolCall("exa_proto_research", { action: "submit", proposalId }), {
        stopReason: "toolUse",
      });
    }
    if (last?.role === "toolResult" && text.includes("Research started")) {
      return fauxAssistantMessage("Research started; I will notify you when it finishes. Feel free to keep chatting.");
    }
    if (last?.role === "toolResult") {
      return fauxAssistantMessage(`The research tool reported: ${text.slice(0, 160)}`);
    }
    return fauxAssistantMessage("Sure, we can talk about something else while it runs.");
  };
  return Array.from({ length: count }, () => step);
}

export default function guidedPrototypeEntry(pi: ExtensionAPI) {
  const exa = createMockExa();
  const bounds = process.env.EXA_PROTO_BOUNDS
    ? (JSON.parse(process.env.EXA_PROTO_BOUNDS) as Partial<MonitorBounds>)
    : undefined;
  if (process.env.EXA_PROTO_SCRIPTED === "1") {
    const faux = fauxProvider({ provider: "exa-proto", models: [{ id: "scripted" }] });
    faux.setResponses(scriptedResponses() as never);
    pi.registerProvider(faux.provider);
  }
  createGuidedPrototype(pi, { exa, bounds });
}
