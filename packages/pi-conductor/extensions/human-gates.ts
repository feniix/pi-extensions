import {
  buildEvidenceBundleForRepo,
  buildResourceTimelineForRepo,
  checkReadinessForRepo,
  getOrCreateRunForRepo,
  prepareHumanReviewForRepo,
  resolveGateFromTrustedHumanForRepo,
} from "./conductor.js";
import type { ArtifactRecord, GateRecord } from "./types.js";

type HumanGateDashboardAction = "packet" | "approve" | "reject" | "cancel";
type HumanGateDecisionResult = "resolved" | "unchanged";

export type HumanGateReview = {
  prompt: string;
  dashboardLines: string[];
};

export type HumanGateDecisionUi = {
  custom?: <T>(
    factory: (
      tui: { requestRender: () => void },
      theme: unknown,
      keybindings: unknown,
      done: (value: T) => void,
    ) => unknown,
    options?: unknown,
  ) => Promise<T | undefined> | T | undefined;
  select?: (message: string, options: string[]) => Promise<string | undefined> | string | undefined;
  editor?: (title: string, text: string) => Promise<string | undefined> | string | undefined;
  input?: (message: string, placeholder?: string) => Promise<string | undefined> | string | undefined;
  notify: (message: string, level?: string) => void;
};

export function toHumanGateDecisionUi(ui: unknown): HumanGateDecisionUi {
  if (!ui || typeof ui !== "object") {
    throw new Error("trusted human gate UI is unavailable");
  }
  const candidate = ui as Partial<HumanGateDecisionUi>;
  if (typeof candidate.notify !== "function") {
    throw new Error("trusted human gate UI requires notify support");
  }
  return {
    notify: candidate.notify.bind(ui),
    custom: typeof candidate.custom === "function" ? candidate.custom.bind(ui) : undefined,
    select: typeof candidate.select === "function" ? candidate.select.bind(ui) : undefined,
    editor: typeof candidate.editor === "function" ? candidate.editor.bind(ui) : undefined,
    input: typeof candidate.input === "function" ? candidate.input.bind(ui) : undefined,
  };
}

function summarizeArtifact(artifact: ArtifactRecord): string {
  return `${artifact.artifactId} [${artifact.type}] ${artifact.ref}`;
}

function buildHumanGateReview(cwd: string, gateId: string): HumanGateReview {
  const run = getOrCreateRunForRepo(cwd);
  const gate = run.gates.find((entry) => entry.gateId === gateId);
  if (!gate) return { prompt: `Gate not found: ${gateId}`, dashboardLines: [`Gate not found: ${gateId}`] };
  const refs = gate.resourceRefs;
  const evidence = buildEvidenceBundleForRepo(cwd, { ...refs, purpose: "handoff", includeEvents: true });
  const timeline = buildResourceTimelineForRepo(cwd, { ...refs, gateId, limit: 10, includeArtifacts: true });
  const review = prepareHumanReviewForRepo(cwd, { objectiveId: refs.objectiveId, taskId: refs.taskId });
  const artifacts = evidence.artifacts.slice(-5).map(summarizeArtifact);
  const readiness =
    gate.operation === "create_worker_pr" || gate.type === "ready_for_pr"
      ? checkReadinessForRepo(cwd, { ...refs, purpose: "pr_readiness" })
      : refs.taskId
        ? checkReadinessForRepo(cwd, { ...refs, purpose: "task_review" })
        : null;
  const readinessText = readiness
    ? `${readiness.status}: blockers=${readiness.blockers.length} warnings=${readiness.warnings.length}`
    : "not applicable";
  const blockerLines = readiness?.blockers.map((blocker) => `- ${blocker.message}`) ?? [];
  const warningLines = readiness?.warnings.map((warning) => `- ${warning.message}`) ?? [];
  const eventLines = timeline.events.slice(-10).map((event) => `#${event.sequence} ${event.type}`);
  const reviewPreview = review.markdown.split("\n").slice(0, 8);
  const dashboardLines = [
    "Conductor Gate Approval",
    `Gate: ${gate.gateId}`,
    `Type: ${gate.type}`,
    `Operation: ${gate.operation}`,
    `Decision: ${gate.requestedDecision}`,
    `Readiness: ${readinessText}`,
    `Evidence: tasks=${evidence.tasks.length} runs=${evidence.runs.length} gates=${evidence.gates.length} artifacts=${evidence.artifacts.length}`,
    evidence.pr?.url ? `PR: ${evidence.pr.url}` : null,
    eventLines.length > 0 ? `Recent: ${eventLines.slice(-3).join(" | ")}` : "Recent: no recent events",
    artifacts.length > 0 ? `Artifacts: ${artifacts.slice(0, 3).join(" | ")}` : "Artifacts: none",
    blockerLines.length > 0 ? `Blockers: ${blockerLines.slice(0, 2).join(" | ")}` : null,
    warningLines.length > 0 ? `Warnings: ${warningLines.slice(0, 2).join(" | ")}` : null,
    "",
    "Review Packet Preview",
    ...reviewPreview,
  ].filter((line): line is string => line !== null);
  const prompt = [
    `Gate ${gate.gateId}`,
    `Type: ${gate.type}`,
    `Status: ${gate.status}`,
    `Operation: ${gate.operation}`,
    `Requested decision: ${gate.requestedDecision}`,
    `Refs: ${JSON.stringify(gate.resourceRefs)}`,
    gate.targetRevision ? `Target revision: ${gate.targetRevision}` : null,
    gate.expiresAt ? `Expires: ${gate.expiresAt}` : null,
    "",
    "Readiness",
    readinessText,
    "",
    "Evidence",
    `tasks=${evidence.tasks.length} runs=${evidence.runs.length} gates=${evidence.gates.length} artifacts=${evidence.artifacts.length}`,
    evidence.pr?.url ? `pr=${evidence.pr.url}` : null,
    "",
    "Timeline",
    eventLines.join("\n") || "no recent events",
    "",
    "Artifacts",
    artifacts.join("\n") || "none",
    "",
    "Blockers",
    blockerLines.join("\n") || "none",
    "",
    "Warnings",
    warningLines.join("\n") || "none",
    "",
    "Review Packet",
    review.markdown,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  return { prompt, dashboardLines };
}

function truncatePlainLine(line: string, width: number): string {
  if (width <= 0) return "";
  return line.length > width ? `${line.slice(0, Math.max(0, width - 1))}…` : line;
}

function normalizeHumanGateAction(action: unknown): HumanGateDashboardAction | null {
  return action === "packet" || action === "approve" || action === "reject" || action === "cancel" ? action : null;
}

function isExpiredOpenGate(gate: GateRecord, now = new Date().toISOString()): boolean {
  return gate.status === "open" && gate.expiresAt !== null && gate.expiresAt <= now;
}

async function chooseHumanGateAction(
  ui: HumanGateDecisionUi,
  review: HumanGateReview,
  input: { includePacket?: boolean; safeDefault?: boolean } = {},
): Promise<HumanGateDashboardAction | null> {
  const includePacket = input.includePacket ?? true;
  const safeDefault = input.safeDefault ?? false;
  if (!ui.custom && !ui.select) {
    ui.notify("trusted human gate approval requires a selectable UI", "error");
    return null;
  }
  if (ui.custom) {
    const action = await ui.custom<HumanGateDashboardAction>((tui, theme, _keybindings, done) => {
      const themeLike = theme as { fg?: (color: string, text: string) => string; bold?: (text: string) => string };
      const fg = (color: string, text: string) => themeLike.fg?.(color, text) ?? text;
      const bold = (text: string) => themeLike.bold?.(text) ?? text;
      const reviewPacketAction = includePacket
        ? [
            {
              value: "packet" as const,
              label: "Open review packet",
              description: "Inspect the full markdown review packet",
            },
          ]
        : [];
      const decisionActions: Array<{ value: HumanGateDashboardAction; label: string; description: string }> = [
        { value: "approve", label: "Approve gate", description: "Allow the gated operation to proceed" },
        { value: "reject", label: "Reject gate", description: "Block the gated operation" },
        { value: "cancel", label: "Cancel", description: "Leave the gate open" },
      ];
      const actions: Array<{ value: HumanGateDashboardAction; label: string; description: string }> = safeDefault
        ? [
            { value: "cancel", label: "Cancel", description: "Leave the gate open" },
            ...reviewPacketAction,
            ...decisionActions.slice(0, 2),
          ]
        : [...reviewPacketAction, ...decisionActions];
      let selected = 0;
      return {
        render(width: number): string[] {
          const plainLines = [
            "Conductor Gate Approval Dashboard",
            "",
            ...review.dashboardLines,
            "",
            "Decision",
            ...actions.map((item, index) => {
              const prefix = index === selected ? "› " : "  ";
              return `${prefix}${item.label} — ${item.description}`;
            }),
            "",
            "↑↓ navigate • enter choose • esc cancel",
          ];
          return plainLines.map((line, index) => {
            const truncated = truncatePlainLine(line, width);
            if (index === 0) return fg("accent", bold(truncated));
            if (truncated === "Decision" || truncated.startsWith("↑↓")) return fg("dim", truncated);
            if (truncated.startsWith("› ")) return fg("accent", truncated);
            return truncated;
          });
        },
        handleInput(data: string): void {
          if (data === "\u001b[A" || data === "k") selected = (selected + actions.length - 1) % actions.length;
          if (data === "\u001b[B" || data === "j") selected = (selected + 1) % actions.length;
          if (data === "\r" || data === "\n") done(actions[selected]?.value ?? "cancel");
          if (data === "\u001b" || data === "\u0003") done("cancel");
          tui.requestRender();
        },
        invalidate(): void {},
      };
    });
    const normalizedAction = normalizeHumanGateAction(action);
    if (action !== undefined && !normalizedAction) {
      ui.notify("trusted human gate approval returned an invalid action", "error");
    }
    return normalizedAction;
  }

  const decision = await ui.select?.(
    review.prompt,
    safeDefault
      ? ["Cancel", ...(includePacket ? ["Open review packet"] : []), "Approve gate", "Reject gate"]
      : [...(includePacket ? ["Open review packet"] : []), "Approve gate", "Reject gate", "Cancel"],
  );
  if (decision === "Open review packet") return "packet";
  if (decision === "Approve gate") return "approve";
  if (decision === "Reject gate") return "reject";
  if (decision === "Cancel") return "cancel";
  if (decision) ui.notify("trusted human gate approval returned an invalid action", "error");
  return decision ? "cancel" : null;
}

async function chooseHumanGateFromQueue(
  ui: HumanGateDecisionUi,
  gates: GateRecord[],
  input: { cwd?: string } = {},
): Promise<string | null> {
  if (gates.length === 0) return null;
  if (!ui.custom && !ui.select) {
    ui.notify("trusted human gate queue requires a selectable UI", "error");
    return null;
  }
  if (ui.custom) {
    const gateId = await ui.custom<string | null>((tui, theme, _keybindings, done) => {
      const themeLike = theme as { fg?: (color: string, text: string) => string; bold?: (text: string) => string };
      const fg = (color: string, text: string) => themeLike.fg?.(color, text) ?? text;
      const bold = (text: string) => themeLike.bold?.(text) ?? text;
      let selected = 0;
      const buildSelectedPreview = () => {
        const selectedGate = gates[selected];
        return input.cwd && selectedGate ? buildHumanGateReview(input.cwd, selectedGate.gateId) : null;
      };
      let selectedReview = buildSelectedPreview();
      return {
        render(width: number): string[] {
          const previewLines = selectedReview
            ? ["", "Selected Gate", ...selectedReview.dashboardLines.slice(1, 14)]
            : [];
          const plainLines = [
            "Conductor Gate Queue Dashboard",
            "",
            ...gates.map((gate, index) => {
              const prefix = index === selected ? "› " : "  ";
              return `${prefix}${gate.gateId} [${gate.type}] ${gate.operation} — ${gate.requestedDecision}`;
            }),
            ...previewLines,
            "",
            "↑↓ navigate • enter review • esc cancel",
          ];
          return plainLines.map((line, index) => {
            const truncated = truncatePlainLine(line, width);
            if (index === 0) return fg("accent", bold(truncated));
            if (truncated.startsWith("› ")) return fg("accent", truncated);
            if (truncated.startsWith("↑↓")) return fg("dim", truncated);
            return truncated;
          });
        },
        handleInput(data: string): void {
          const previousSelected = selected;
          if (data === "\u001b[A" || data === "k") selected = (selected + gates.length - 1) % gates.length;
          if (data === "\u001b[B" || data === "j") selected = (selected + 1) % gates.length;
          if (selected !== previousSelected) selectedReview = buildSelectedPreview();
          if (data === "\r" || data === "\n") done(gates[selected]?.gateId ?? null);
          if (data === "\u001b" || data === "\u0003") done(null);
          tui.requestRender();
        },
        invalidate(): void {},
      };
    });
    if (gateId === null || gateId === undefined) return null;
    if (gates.some((gate) => gate.gateId === gateId)) return gateId;
    ui.notify("trusted human gate queue returned an invalid gate", "error");
    return null;
  }
  const labels = gates.map((gate) => `${gate.gateId} [${gate.type}] ${gate.requestedDecision}`);
  const selected = await ui.select?.("Select a conductor gate to review", [...labels, "Cancel"]);
  if (!selected || selected === "Cancel") return null;
  const selectedGateId = gates[labels.indexOf(selected)]?.gateId;
  if (selectedGateId) return selectedGateId;
  ui.notify("trusted human gate queue returned an invalid gate", "error");
  return null;
}

export async function resolveHumanGateDecision(
  cwd: string,
  gateId: string,
  reasonArg: string | undefined,
  ui: HumanGateDecisionUi,
  input: { safeDefault?: boolean } = {},
): Promise<HumanGateDecisionResult> {
  const review = buildHumanGateReview(cwd, gateId);
  let action = await chooseHumanGateAction(ui, review, {
    includePacket: Boolean(ui.editor),
    safeDefault: input.safeDefault,
  });
  while (action === "packet") {
    await ui.editor?.("Conductor gate review packet", review.prompt);
    action = await chooseHumanGateAction(ui, review, {
      includePacket: Boolean(ui.editor),
      safeDefault: input.safeDefault,
    });
  }
  if (!action || action === "cancel") {
    ui.notify(`left gate ${gateId} open`, "info");
    return "unchanged";
  }
  const status = action === "reject" ? "rejected" : "approved";
  const defaultReason = status === "approved" ? "Approved from pi conductor UI" : "Rejected from pi conductor UI";
  const reason =
    reasonArg?.trim() || (await ui.input?.("Reason for this gate decision", defaultReason)) || defaultReason;
  const humanId = `ui:${process.env.USER ?? "local-human"}`;
  const resolved = resolveGateFromTrustedHumanForRepo(cwd, {
    gateId,
    status,
    humanId,
    resolutionReason: reason,
  });
  ui.notify(`${status} gate ${resolved.gateId} as trusted human`, "info");
  return "resolved";
}

export async function openHumanGateQueueDashboard(
  cwd: string,
  ui: HumanGateDecisionUi,
  input: { reason?: string; once?: boolean } = {},
) {
  let resolvedCount = 0;
  while (true) {
    const run = getOrCreateRunForRepo(cwd);
    const openGates = run.gates.filter((gate) => gate.status === "open");
    const gates = openGates.filter((gate) => !isExpiredOpenGate(gate));
    const expiredCount = openGates.length - gates.length;
    if (expiredCount > 0) {
      ui.notify(
        `skipped ${expiredCount} expired conductor gate(s); run reconcile or inspect conductor_list_gates`,
        "error",
      );
    }
    if (gates.length === 0) {
      ui.notify(
        resolvedCount === 0 ? "no open conductor gates" : `resolved ${resolvedCount} conductor gate(s)`,
        "info",
      );
      return;
    }
    const gateId = await chooseHumanGateFromQueue(ui, gates, { cwd });
    if (!gateId) {
      ui.notify(
        resolvedCount === 0 ? "left conductor gates unchanged" : `resolved ${resolvedCount} conductor gate(s)`,
        "info",
      );
      return;
    }
    let result: HumanGateDecisionResult;
    try {
      result = await resolveHumanGateDecision(cwd, gateId, input.reason, ui, { safeDefault: !input.once });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ui.notify(`gate ${gateId} changed before decision; refreshed conductor gates (${message})`, "error");
      continue;
    }
    if (result !== "resolved") {
      if (resolvedCount > 0) ui.notify(`resolved ${resolvedCount} conductor gate(s)`, "info");
      return;
    }
    resolvedCount += 1;
    if (input.once) return;
  }
}
