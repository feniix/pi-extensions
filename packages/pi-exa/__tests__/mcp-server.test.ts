/**
 * MCP server wiring tests for pi-exa.
 *
 * These tests construct createMcpServerOptions() in-process and assert that
 * the tool surface, server identity, and env-driven gating semantics match
 * the documented contract. They do not exercise the MCP wire protocol —
 * bridgekit's own test suite covers tools/list and tools/call against the
 * real Server instance.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpServer } from "@feniix/bridgekit/mcp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMcpServerOptions, runServer } from "../extensions/mcp-server.js";

const packageJson = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf-8"),
) as { version: string };

const toolNames = (options: ReturnType<typeof createMcpServerOptions>) => options.tools.map((tool) => tool.name);

const GATING_ENV_KEYS = [
  "EXA_API_KEY",
  "EXA_ENABLED_TOOLS",
  "EXA_ENABLE_ADVANCED",
  "EXA_ENABLE_RESEARCH",
  "EXA_CONFIG_FILE",
  "EXA_CONFIG",
] as const;

describe("pi-exa MCP server", () => {
  // Sandbox HOME + CWD so loadConfig() never picks up real ~/.pi/agent/settings.json
  // or .pi/settings.json in the dev tree. Mirrors extension.test.ts.
  const originalHome = process.env.HOME;
  const originalCwd = process.cwd();
  const originalEnv: Partial<Record<(typeof GATING_ENV_KEYS)[number], string | undefined>> = {};

  beforeAll(() => {
    const sandboxHome = mkdtempSync(join(tmpdir(), "pi-exa-mcp-home-"));
    const sandboxProject = mkdtempSync(join(tmpdir(), "pi-exa-mcp-project-"));
    process.env.HOME = sandboxHome;
    process.chdir(sandboxProject);
  });

  afterAll(() => {
    process.chdir(originalCwd);
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
  });

  beforeEach(() => {
    for (const key of GATING_ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of GATING_ENV_KEYS) {
      const previous = originalEnv[key];
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  });

  it("advertises 'pi-exa', the package version, and Exa-oriented instructions", () => {
    const options = createMcpServerOptions();

    expect(options.name).toBe("pi-exa");
    expect(options.version).toBe(packageJson.version);
    expect(options.instructions).toContain("Exa");
  });

  it("exposes the 8 always-on tools and hides advanced/research by default", () => {
    const options = createMcpServerOptions();
    const names = toolNames(options);

    expect(names).toEqual(
      expect.arrayContaining([
        "web_search_exa",
        "web_fetch_exa",
        "web_answer_exa",
        "web_find_similar_exa",
        "exa_research_step",
        "exa_research_status",
        "exa_research_summary",
        "exa_research_reset",
      ]),
    );
    expect(names).not.toContain("web_search_advanced_exa");
    expect(names).not.toContain("web_research_exa");
    expect(names).toHaveLength(8);
  });

  it("exposes web_search_advanced_exa when EXA_ENABLE_ADVANCED is truthy", () => {
    process.env.EXA_ENABLE_ADVANCED = "1";

    expect(toolNames(createMcpServerOptions())).toContain("web_search_advanced_exa");
  });

  it("exposes web_research_exa when EXA_ENABLE_RESEARCH is truthy", () => {
    process.env.EXA_ENABLE_RESEARCH = "true";

    expect(toolNames(createMcpServerOptions())).toContain("web_research_exa");
  });

  it("EXA_ENABLED_TOOLS allowlist overrides per-tool toggles", () => {
    process.env.EXA_ENABLE_ADVANCED = "1";
    process.env.EXA_ENABLED_TOOLS = "web_search_exa, web_fetch_exa";

    const names = toolNames(createMcpServerOptions());
    expect(names).toEqual(["web_search_exa", "web_fetch_exa"]);
  });

  it("warns and falls back to defaults when EXA_ENABLED_TOOLS parses to an empty allowlist", () => {
    process.env.EXA_ENABLED_TOOLS = ",,,";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const names = toolNames(createMcpServerOptions());

    expect(names).toEqual(
      expect.arrayContaining([
        "web_search_exa",
        "web_fetch_exa",
        "web_answer_exa",
        "web_find_similar_exa",
        "exa_research_step",
      ]),
    );
    expect(names).toHaveLength(8);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("EXA_ENABLED_TOOLS"));
    warn.mockRestore();
  });

  it("constructs a bridgekit MCP server from the options without throwing", () => {
    const server = createMcpServer(createMcpServerOptions());

    expect(server).toBeDefined();
  });

  it("runServer delegates to the injected runMcpStdioServer with the options", async () => {
    const runMcpStdioServer = vi.fn().mockResolvedValue(undefined);

    await runServer(runMcpStdioServer);

    expect(runMcpStdioServer).toHaveBeenCalledTimes(1);
    expect(runMcpStdioServer).toHaveBeenCalledWith(
      expect.objectContaining({ name: "pi-exa", instructions: expect.stringContaining("Exa") }),
    );
  });
});
