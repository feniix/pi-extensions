import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertDistinctStores, canonicalPath, parseConfig, resolveConfig } from "../extensions/config.js";
import { createConfiguredJournal } from "../extensions/index.js";

describe("Agent Journal config", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("parses bounded positive settings and resolves relative storage", () => {
    expect(parseConfig({ storageDir: "state", maxBytes: 1000, maxLines: -1 })).toMatchObject({
      storageDir: "state",
      maxBytes: 1000,
      maxLines: 2000,
    });
    expect(resolveConfig({ storageDir: "state" }).storageDir).toBe(join(process.cwd(), "state"));
  });

  it("preserves sparse global limits while applying environment and CLI storage precedence", async () => {
    const original = process.env.AGENT_JOURNAL_STORAGE_DIR;
    const root = mkdtempSync(join(tmpdir(), "journal-config-precedence-"));
    roots.push(root);
    const envStore = join(root, "env-store");
    const flagStore = join(root, "flag-store");
    process.env.AGENT_JOURNAL_STORAGE_DIR = envStore;
    try {
      const globalConfig = parseConfig({ maxBytes: 90_000, maxLines: 900, maxEntryBytes: 3210 });
      const projectConfig = parseConfig({ maxCheckpointBytes: 4321 });
      const layered = { ...globalConfig, ...projectConfig };
      const fromEnvironment = resolveConfig(layered);
      expect(fromEnvironment).toMatchObject({
        storageDir: envStore,
        maxBytes: 90_000,
        maxLines: 900,
        maxEntryBytes: 3210,
        maxCheckpointBytes: 4321,
      });

      const resolveWithFlag = resolveConfig as unknown as (
        input: Parameters<typeof resolveConfig>[0],
        storageFlag?: string,
      ) => ReturnType<typeof resolveConfig>;
      const fromFlag = resolveWithFlag(layered, flagStore);
      expect(fromFlag.storageDir).toBe(flagStore);
      const { storage, service } = createConfiguredJournal(fromFlag, process.cwd());
      await storage.createSession("precedence");
      await expect(service.record("precedence", { type: "observation", content: "x".repeat(3211) })).rejects.toThrow(
        /byte limit/i,
      );
    } finally {
      if (original === undefined) delete process.env.AGENT_JOURNAL_STORAGE_DIR;
      else process.env.AGENT_JOURNAL_STORAGE_DIR = original;
    }
  });

  it("flows configured persistence and domain limits into storage and service", async () => {
    const root = mkdtempSync(join(tmpdir(), "journal-config-flow-"));
    roots.push(root);
    const { storage, service } = createConfiguredJournal(
      {
        storageDir: root,
        maxBytes: 50_000,
        maxLines: 2_000,
        maxEntryBytes: 8,
        maxCheckpointBytes: 200,
      },
      process.cwd(),
    );
    await storage.createSession("work");
    await expect(service.record("work", { type: "observation", content: "123456789" })).rejects.toThrow(/byte limit/i);
    await expect(service.createCheckpoint("work", { objective: "x".repeat(300), status: "active" })).rejects.toThrow(
      /byte limit/i,
    );
  });

  it("canonicalizes missing descendants through existing symlink ancestors", () => {
    const root = mkdtempSync(join(tmpdir(), "journal-config-"));
    roots.push(root);
    const actual = join(root, "actual");
    mkdirSync(actual);
    const alias = join(root, "alias");
    symlinkSync(actual, alias);
    expect(canonicalPath(join(alias, "nested"))).toBe(join(realpathSync(actual), "nested"));
  });

  it("rejects direct and aliased Pi/MCP store collisions", () => {
    const root = mkdtempSync(join(tmpdir(), "journal-config-"));
    roots.push(root);
    const actual = join(root, "store");
    mkdirSync(actual);
    const alias = join(root, "alias");
    symlinkSync(actual, alias);
    expect(() => assertDistinctStores(actual, actual)).toThrow(/distinct/i);
    expect(() => assertDistinctStores(actual, alias)).toThrow(/distinct/i);
  });
});
