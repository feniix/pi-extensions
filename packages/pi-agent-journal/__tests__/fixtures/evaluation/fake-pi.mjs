#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const request = JSON.parse(readFileSync(0, "utf8"));
const result = {
  processId: String(process.pid),
  completed: true,
  rawJsonl: "",
  ephemeralTracePaths: [join(request.conditionTrialDir, `phase-${request.phase}.jsonl`)],
};
if (request.condition === "baseline" && request.phase === "A") {
  const path = join(request.conditionTrialDir, "generated-status.txt");
  writeFileSync(
    path,
    [
      "objective: generated during phase A",
      "current status: paused",
      "settled decisions: none",
      "evidence: none",
      "open questions: none",
      "next action: resume",
      "material dependencies: none",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  result.generatedStatus = {
    path,
    generatedByPhaseA: true,
    byteLength: Buffer.byteLength(readFileSync(path, "utf8"), "utf8"),
    fields: [
      "objective",
      "current_status",
      "settled_decisions",
      "evidence",
      "open_questions",
      "next_action",
      "material_dependencies",
    ],
    actions: ["status_create"],
    ownerProtocolDigest: "fc06cb28293ffe1bdf428c89d0d9d3420fcabc42bc77acc6dffc8de4f2649409",
  };
}
if (request.condition === "baseline" && request.phase === "B") {
  readFileSync(request.generatedStatusPath, "utf8");
}
if (request.condition === "journal" && request.phase === "A") {
  result.autonomousCheckpoint = true;
  result.ownerJournalCalls = 0;
  result.sessionPath = join(request.conditionTrialDir, "session.jsonl");
  result.storePath = join(request.conditionTrialDir, "store");
  mkdirSync(result.storePath, { recursive: true, mode: 0o700 });
  writeFileSync(result.sessionPath, "generated-session\n", { mode: 0o600 });
}
if (request.condition === "journal" && request.phase === "B") {
  result.freshProcessResume = true;
  result.boundedUntrustedResume = true;
  result.resumeCapsuleBytes = 1024;
  readFileSync(request.sessionPath, "utf8");
  mkdirSync(request.storePath, { recursive: true, mode: 0o700 });
}
const events = [
  {
    type: "evaluation_trace",
    schemaVersion: 2,
    sourceEvaluationVersion: 2,
    runId: request.runId,
    taskId: request.taskId,
    taskScore: 10,
    resumedWithoutRestatement: true,
    materialTaskCorrect: true,
  },
];
if (request.phase === "A") {
  events.push({ type: "evaluation_pause", pausePoint: request.parity.pausePoint, observed: true });
}
if (request.condition === "baseline" && request.phase === "A") {
  events.push({ type: "evaluation_intervention", id: `owner-${request.runId}`, kind: "status_create", sequence: 1 });
}
result.rawJsonl = events.map((event) => JSON.stringify(event)).join("\n");
writeFileSync(result.ephemeralTracePaths[0], result.rawJsonl, { mode: 0o600 });
process.stdout.write(JSON.stringify(result));
