import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureDeterministicFacts } from "../extensions/capture-policy.js";
import { JournalService } from "../extensions/journal-service.js";
import { JournalStorage } from "../extensions/storage.js";

describe("capture policy and journal service", () => {
  let root: string;
  let workspace: string;
  let service: JournalService;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "journal-service-"));
    workspace = join(root, "workspace");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(workspace, { recursive: true });
    const storage = new JournalStorage(join(root, "store"));
    await storage.createSession("work");
    service = new JournalService({
      storage,
      workspaceRoot: workspace,
      clock: () => "2026-07-12T00:00:00.000Z",
      repositoryStateProvider: async () => "head-2",
      toolVersionProvider: async (tool) => (tool === "node" ? "24.0.0" : null),
    });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("captures deterministic facts but ignores narration and raw tool output", () => {
    expect(captureDeterministicFacts({ kind: "assistant_message", text: "Maybe try three ideas" })).toEqual([]);
    expect(
      captureDeterministicFacts({ kind: "tool_result", tool: "read", success: true, output: "entire file" }),
    ).toEqual([]);
    expect(
      captureDeterministicFacts({
        kind: "validation",
        command: "npm test sk-proj-abcdefghijklmnopqrstuvwxyz123456",
        success: true,
      }),
    ).toEqual([]);
    expect(
      captureDeterministicFacts({ kind: "validation", command: "npm test", success: true, artifacts: ["src/a.ts"] }),
    ).toEqual([
      expect.objectContaining({ type: "validation", content: "npm test passed", artifactPaths: ["src/a.ts"] }),
    ]);
  });

  it("records entries and projects append-only relationship state", async () => {
    await service.record("work", { id: "old", type: "decision", content: "old" });
    await service.record("work", {
      id: "new",
      type: "decision",
      content: "new",
      relationships: [{ type: "supersedes", targetEntryId: "old" }],
    });
    await service.record("work", {
      id: "option",
      type: "assumption",
      content: "another option",
      relationships: [{ type: "alternative-to", targetEntryId: "new" }],
    });
    expect((await service.inspectCurrent("work")).unresolvedAlternatives).toEqual([["new", "option"]]);
    await service.record("work", {
      id: "rejected",
      type: "rejected_alternative",
      content: "option rejected",
      relationships: [{ type: "supersedes", targetEntryId: "option" }],
    });
    const current = await service.inspectCurrent("work");
    expect(current.unresolvedAlternatives).toEqual([]);
    expect(current.settledEntries.map((item) => item.id)).toEqual(["new", "rejected"]);
    expect((await service.inspectHistory("work")).map((item) => item.id)).toEqual(["old", "new", "option", "rejected"]);
  });

  it.each([
    "decision",
    "rejected_alternative",
  ] as const)("settles an alternative pair when a later %s links to the losing option", async (resolutionType) => {
    await service.record("work", { id: "option-a", type: "assumption", content: "Use A" });
    await service.record("work", {
      id: "option-b",
      type: "assumption",
      content: "Use B",
      relationships: [{ type: "alternative-to", targetEntryId: "option-a" }],
    });
    expect((await service.inspectCurrent("work")).unresolvedAlternatives).toEqual([["option-a", "option-b"]]);

    await service.record("work", {
      id: "resolution",
      type: resolutionType,
      content: resolutionType === "decision" ? "Choose A" : "Reject B",
      relationships: [{ type: "alternative-to", targetEntryId: "option-b" }],
    });
    const current = await service.inspectCurrent("work");
    expect(current.unresolvedAlternatives).toEqual([]);
    expect((await service.inspectHistory("work")).map((entry) => entry.id)).toEqual([
      "option-a",
      "option-b",
      "resolution",
    ]);
  });

  it("rejects missing, duplicate, cross-session, and cyclic links", async () => {
    await service.record("work", { id: "a", type: "decision", content: "a" });
    await expect(
      service.record("work", {
        id: "b",
        type: "decision",
        content: "b",
        relationships: [{ type: "supersedes", targetEntryId: "missing" }],
      }),
    ).rejects.toThrow(/target/i);
    await service.record("work", {
      id: "b",
      type: "decision",
      content: "b",
      relationships: [{ type: "supersedes", targetEntryId: "a" }],
    });
    await expect(
      service.record("work", {
        id: "a2",
        type: "decision",
        content: "a2",
        relationships: [
          { type: "alternative-to", targetEntryId: "a" },
          { type: "alternative-to", targetEntryId: "a" },
        ],
      }),
    ).rejects.toThrow(/duplicate/i);
  });

  it("creates compact checkpoints, coalesces unchanged state, and resumes only referenced state", async () => {
    await service.record("work", { id: "evidence", type: "evidence", content: "proof" });
    await service.record("work", { id: "next", type: "next_action", content: "continue" });
    const draft = {
      objective: "ship",
      status: "active",
      evidenceEntryIds: ["evidence"],
      nextActionEntryId: "next",
    };
    const checkpoint = await service.createCheckpoint("work", { id: "cp", ...draft });
    const unchanged = await service.createCheckpoint("work", { id: "ignored", ...draft });
    const resumed = await service.resume("work");
    expect(unchanged.id).toBe("cp");
    expect(checkpoint.supportEntryIds).toEqual(["evidence", "next"]);
    expect(resumed.entries.map((item) => item.id)).toEqual(["evidence", "next"]);
  });

  it.each([
    {
      role: "settled decision",
      entry: { id: "observation", type: "observation" as const, content: "fact" },
      draft: { settledDecisionEntryIds: ["observation"] },
    },
    {
      role: "evidence",
      entry: { id: "assumption", type: "assumption" as const, content: "guess" },
      draft: { evidenceEntryIds: ["assumption"] },
    },
    {
      role: "next action",
      entry: { id: "decision", type: "decision" as const, content: "choice" },
      draft: { nextActionEntryId: "decision" },
    },
  ])("rejects a checkpoint $role reference whose entry type does not match", async ({ entry, draft }) => {
    await service.record("work", entry);
    await expect(service.createCheckpoint("work", { objective: "ship", status: "active", ...draft })).rejects.toThrow(
      /checkpoint.*type|must reference/i,
    );
    expect((await service.resume("work")).checkpoint).toBeNull();
  });

  it("enforces checkpoint item bounds", async () => {
    await expect(
      service.createCheckpoint("work", {
        objective: "ship",
        status: "active",
        openQuestions: Array.from({ length: 101 }, (_, index) => `question-${index}`),
      }),
    ).rejects.toThrow(/item limit/i);
  });

  it("rejects checkpoints with dependencies that reference missing entries", async () => {
    await expect(
      service.createCheckpoint("work", {
        id: "bad-cp",
        objective: "ship",
        status: "active",
        artifactDependencies: [
          {
            kind: "external",
            source: "https://example.test",
            revalidateAfter: "2026-07-13T00:00:00.000Z",
            observedAt: "2026-07-12T00:00:00.000Z",
            originatingEntryId: "missing",
            material: true,
          },
        ],
      }),
    ).rejects.toThrow(/dependency.*missing/i);
  });

  it("classifies file freshness and refuses unsafe reads", async () => {
    const { mkdirSync, symlinkSync } = await import("node:fs");
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, "a.txt"), "one", "utf8");
    const dependency = await service.observeFileDependency("a.txt", "evidence", true);
    expect((await service.verifyDependency(dependency)).status).toBe("fresh");
    writeFileSync(join(workspace, "a.txt"), "two", "utf8");
    expect((await service.verifyDependency(dependency)).status).toBe("stale");
    symlinkSync("a.txt", join(workspace, "link.txt"));
    await expect(service.observeFileDependency("link.txt", "evidence", true)).rejects.toThrow(/symlink/i);
    mkdirSync(join(workspace, "directory"));
    await expect(service.observeFileDependency("directory", "evidence", true)).rejects.toThrow(/regular file/i);
    writeFileSync(join(workspace, "large.bin"), Buffer.alloc(2 * 1024 * 1024 + 1));
    await expect(service.observeFileDependency("large.bin", "evidence", true)).rejects.toThrow(/byte limit/i);
    await expect(service.observeFileDependency("../outside", "evidence", true)).rejects.toThrow(/workspace/i);
  });

  it("excludes stale material supporting entries from resumable current state", async () => {
    writeFileSync(join(workspace, "state.txt"), "one", "utf8");
    const dependency = await service.observeFileDependency("state.txt", "file-evidence", true);
    await service.record("work", {
      id: "file-evidence",
      type: "evidence",
      content: "state file proves the result",
      dependencies: [dependency],
    });
    await service.createCheckpoint("work", {
      objective: "ship",
      status: "active",
      evidenceEntryIds: ["file-evidence"],
      artifactDependencies: [dependency],
    });
    writeFileSync(join(workspace, "state.txt"), "two", "utf8");

    const resumed = await service.resume("work");
    expect(resumed.freshness).toEqual([expect.objectContaining({ status: "stale" })]);
    expect(resumed.notices).toEqual([
      expect.objectContaining({ category: "stale", affectedIds: ["file-evidence"], requiresJudgment: true }),
    ]);
    expect(resumed.entries.map((entry) => entry.id)).not.toContain("file-evidence");
  });

  it("resolves stale notices after a superseding fresh checkpoint without deleting notice history", async () => {
    await service.record("work", { id: "old-evidence", type: "evidence", content: "old proof" });
    const staleDependency = {
      kind: "repository_state" as const,
      value: "head-1",
      observedAt: "2026-07-11T00:00:00.000Z",
      originatingEntryId: "old-evidence",
      material: true,
    };
    await service.createCheckpoint("work", {
      objective: "ship",
      status: "active",
      evidenceEntryIds: ["old-evidence"],
      artifactDependencies: [staleDependency],
    });
    expect((await service.resume("work")).notices).toEqual([
      expect.objectContaining({ affectedIds: ["old-evidence"], requiresJudgment: true }),
    ]);

    await service.record("work", {
      id: "new-evidence",
      type: "evidence",
      content: "revalidated proof",
      relationships: [{ type: "supersedes", targetEntryId: "old-evidence" }],
    });
    const freshDependency = {
      ...staleDependency,
      value: "head-2",
      originatingEntryId: "new-evidence",
    };
    await service.createCheckpoint("work", {
      objective: "ship",
      status: "active",
      evidenceEntryIds: ["new-evidence"],
      artifactDependencies: [freshDependency],
    });

    const first = await service.resume("work");
    const second = await service.resume("work");
    expect(first.entries.map((entry) => entry.id)).toEqual(["new-evidence"]);
    expect(first.notices).toEqual([
      expect.objectContaining({ affectedIds: ["old-evidence"], requiresJudgment: false }),
    ]);
    expect(second.notices).toHaveLength(1);
    expect(second.notices[0].requiresJudgment).toBe(false);
    expect((await service.inspectHistory("work")).map((entry) => entry.id)).toEqual(["old-evidence", "new-evidence"]);
  });

  it("persists judgment notices only for material non-fresh dependencies", async () => {
    await service.record("work", { id: "evidence", type: "evidence", content: "proof" });
    await service.createCheckpoint("work", {
      objective: "ship",
      status: "active",
      evidenceEntryIds: ["evidence"],
      artifactDependencies: [
        {
          kind: "repository_state",
          value: "head-1",
          observedAt: "2026-07-11T00:00:00.000Z",
          originatingEntryId: "evidence",
          material: true,
        },
        {
          kind: "tool_version",
          tool: "node",
          version: "old",
          observedAt: "2026-07-11T00:00:00.000Z",
          originatingEntryId: "evidence",
          material: false,
        },
      ],
    });
    const first = await service.resume("work");
    const second = await service.resume("work");
    expect(first.notices).toHaveLength(1);
    expect(first.notices[0]).toMatchObject({ category: "stale", requiresJudgment: true });
    expect(second.notices).toHaveLength(1);
  });

  it("verifies repository, tool, and external freshness dependencies", async () => {
    expect(
      await service.verifyDependency({
        kind: "repository_state",
        value: "head-1",
        observedAt: "2026-07-11T00:00:00.000Z",
        originatingEntryId: "evidence",
        material: true,
      }),
    ).toMatchObject({ status: "stale" });
    expect(
      await service.verifyDependency({
        kind: "tool_version",
        tool: "node",
        version: "24.0.0",
        observedAt: "2026-07-11T00:00:00.000Z",
        originatingEntryId: "evidence",
        material: true,
      }),
    ).toMatchObject({ status: "fresh" });
    expect(
      await service.verifyDependency({
        kind: "external",
        source: "https://example.test",
        revalidateAfter: "2026-07-11T00:00:00.000Z",
        observedAt: "2026-07-10T00:00:00.000Z",
        originatingEntryId: "evidence",
        material: true,
      }),
    ).toMatchObject({ status: "unverifiable" });
  });

  it("bounds provider freshness checks and classifies failures as unverifiable", async () => {
    const timedService = new JournalService({
      storage: new JournalStorage(join(root, "store")),
      workspaceRoot: workspace,
      repositoryStateProvider: () => new Promise(() => undefined),
      freshnessTimeoutMs: 5,
    });
    expect(
      await timedService.verifyDependency({
        kind: "repository_state",
        value: "head",
        observedAt: "2026-07-11T00:00:00.000Z",
        originatingEntryId: "evidence",
        material: true,
      }),
    ).toMatchObject({ status: "unverifiable" });
  });

  it("never persists or echoes detected credentials", async () => {
    const token = "sk-proj-abcdefghijklmnopqrstuvwxyz123456";
    await expect(service.record("work", { id: "secret", type: "evidence", content: token })).rejects.toThrow(
      /credential/i,
    );
    for (const relativePath of readdirSync(join(root, "store"), { recursive: true, encoding: "utf8" })) {
      const path = join(root, "store", relativePath);
      if (statSync(path).isFile()) expect(readFileSync(path, "utf8")).not.toContain(token);
    }
  });

  it("recursively excludes credentials from every entry and checkpoint field", async () => {
    const token = `ghp_${"a".repeat(30)}`;
    const entry = await service.record("work", { id: "origin", type: "observation", content: "safe" });
    const entryCandidates = [
      { id: token, type: "evidence" as const, content: "safe" },
      {
        type: "evidence" as const,
        content: "safe",
        relationships: [{ type: "supersedes" as const, targetEntryId: token }],
      },
      {
        id: "dependency-entry",
        type: "evidence" as const,
        content: "safe",
        dependencies: [
          {
            kind: "tool_version" as const,
            tool: token,
            version: "1",
            observedAt: "now",
            originatingEntryId: "dependency-entry",
            material: true,
          },
        ],
      },
    ];
    for (const candidate of entryCandidates) {
      await expect(service.record("work", candidate)).rejects.toThrow(/credential/i);
    }
    const dependencyCandidates = [
      {
        kind: "file" as const,
        path: token,
        workspaceId: "workspace",
        observedHash: "hash",
        observedAt: "now",
        originatingEntryId: entry.id,
        material: true,
      },
      {
        kind: "file" as const,
        path: "file",
        workspaceId: token,
        observedHash: "hash",
        observedAt: "now",
        originatingEntryId: entry.id,
        material: true,
      },
      {
        kind: "file" as const,
        path: "file",
        workspaceId: "workspace",
        observedHash: token,
        observedAt: "now",
        originatingEntryId: entry.id,
        material: true,
      },
      {
        kind: "repository_state" as const,
        value: token,
        observedAt: "now",
        originatingEntryId: entry.id,
        material: true,
      },
      {
        kind: "tool_version" as const,
        tool: token,
        version: "1",
        observedAt: "now",
        originatingEntryId: entry.id,
        material: true,
      },
      {
        kind: "tool_version" as const,
        tool: "node",
        version: token,
        observedAt: "now",
        originatingEntryId: entry.id,
        material: true,
      },
      {
        kind: "external" as const,
        source: token,
        revalidateAfter: "later",
        observedAt: "now",
        originatingEntryId: entry.id,
        material: true,
      },
      {
        kind: "external" as const,
        source: "source",
        revalidateAfter: token,
        observedAt: "now",
        originatingEntryId: entry.id,
        material: true,
      },
      {
        kind: "external" as const,
        source: "source",
        revalidateAfter: "later",
        observedAt: token,
        originatingEntryId: entry.id,
        material: true,
      },
      {
        kind: "external" as const,
        source: "source",
        revalidateAfter: "later",
        observedAt: "now",
        originatingEntryId: token,
        material: true,
      },
    ];
    const checkpointCandidates = [
      { id: token, objective: "safe", status: "active" },
      { objective: token, status: "active" },
      { objective: "safe", status: token },
      { objective: "safe", status: "active", openQuestions: [token] },
      { objective: "safe", status: "active", settledDecisionEntryIds: [token] },
      { objective: "safe", status: "active", evidenceEntryIds: [token] },
      { objective: "safe", status: "active", nextActionEntryId: token },
      { objective: "safe", status: "active", supportEntryIds: [token] },
      ...dependencyCandidates.map((dependency) => ({
        objective: "safe",
        status: "active",
        artifactDependencies: [dependency],
      })),
    ];
    for (const candidate of checkpointCandidates) {
      await expect(service.createCheckpoint("work", candidate)).rejects.toThrow(/credential/i);
    }
    const persistedFiles: string[] = [];
    for (const relativePath of readdirSync(join(root, "store"), { recursive: true, encoding: "utf8" })) {
      const path = join(root, "store", relativePath);
      if (statSync(path).isFile()) persistedFiles.push(readFileSync(path, "utf8"));
    }
    expect(persistedFiles.join("\n")).not.toContain(token);
    expect(persistedFiles.join("\n")).toContain("Detected credential candidate was excluded");
  });

  it("sanitizes terminal control text for human output", () => {
    expect(service.renderHumanText("safe\u001b]0;owned\u0007 text")).toBe("safe text");
  });
});
