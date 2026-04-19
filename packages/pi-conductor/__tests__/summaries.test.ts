import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateWorkerSummaryFromSession } from "../extensions/summaries.js";

describe("generateWorkerSummaryFromSession", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("extracts text from a persisted pi session file", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-conductor-summary-"));
    tempDirs.push(dir);
    const sessionFile = join(dir, "worker.jsonl");
    writeFileSync(
      sessionFile,
      `${[
        JSON.stringify({
          type: "session",
          version: 3,
          id: "session-1",
          timestamp: "2026-01-01T00:00:00.000Z",
          cwd: "/tmp/repo",
        }),
        JSON.stringify({
          type: "message",
          id: "u1",
          parentId: null,
          timestamp: "2026-01-01T00:00:01.000Z",
          message: { role: "user", content: "Implement status output" },
        }),
        JSON.stringify({
          type: "message",
          id: "a1",
          parentId: "u1",
          timestamp: "2026-01-01T00:00:02.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Added status output and worker recovery handling." }],
          },
        }),
      ].join("\n")}
`,
      "utf-8",
    );

    expect(generateWorkerSummaryFromSession(sessionFile)).toBe(
      "Implement status output | Added status output and worker recovery handling.",
    );
  });
});
