import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CONFIG_FILE,
  formatSessionStartMessage,
  parseConfig,
  parseTimeoutMs,
  resolveConfigPath,
  resolveRuntimeSettings,
} from "../extensions/index.js";

describe("pi-ref-tools config", () => {
  it("keeps DEFAULT_CONFIG_FILE available for reference", () => {
    expect(DEFAULT_CONFIG_FILE).toMatchObject({
      url: "https://api.ref.tools/mcp",
      maxBytes: 51200,
      maxLines: 2000,
    });
  });

  it("parses timeout values", () => {
    expect(parseTimeoutMs("250", 10)).toBe(250);
    expect(parseTimeoutMs("0", 10)).toBe(10);
    expect(parseTimeoutMs(undefined, 30000)).toBe(30000);
    expect(parseTimeoutMs("abc", 500)).toBe(500);
  });

  it("resolves paths starting with ~", () => {
    const result = resolveConfigPath("~/.pi/config.json");
    expect(result).toContain(homedir());
    expect(result).toContain(".pi/config.json");
  });

  it("returns absolute paths as-is", () => {
    const absolute = "/absolute/path/to/config.json";
    expect(resolveConfigPath(absolute)).toBe(absolute);
  });

  it("resolves relative paths from cwd", () => {
    const result = resolveConfigPath("relative/path.json");
    expect(result).toBe(resolve(process.cwd(), "relative/path.json"));
  });

  it("trims config path whitespace", () => {
    const result = resolveConfigPath("  ~/.pi/config.json  ");
    expect(result).toContain(".pi/config.json");
  });

  it("parses valid config", () => {
    const raw = {
      url: "https://api.example.com/mcp",
      apiKey: "secret-key",
      timeoutMs: 15000,
      protocolVersion: "2025-01-01",
      maxBytes: 1024,
      maxLines: 500,
    };

    expect(parseConfig(raw, "/path/to/config.json")).toEqual(raw);
  });

  it("normalizes string values in config", () => {
    const raw = { url: "  https://api.example.com  ", apiKey: "  " };
    const result = parseConfig(raw, "/path");

    expect(result.url).toBe("https://api.example.com");
    expect(result.apiKey).toBeUndefined();
  });

  it("ignores nullish or invalid config values", () => {
    const raw = { url: null, apiKey: undefined, timeoutMs: Number.NaN };
    const result = parseConfig(raw, "/path");

    expect(result.url).toBeUndefined();
    expect(result.apiKey).toBeUndefined();
    expect(result.timeoutMs).toBeUndefined();
  });

  it("throws for non-object config", () => {
    expect(() => parseConfig(null, "/path")).toThrow("Invalid Ref MCP config");
    expect(() => parseConfig("string", "/path")).toThrow("Invalid Ref MCP config");
    expect(() => parseConfig(123, "/path")).toThrow("Invalid Ref MCP config");
  });

  it("preserves finite numeric config values", () => {
    expect(parseConfig({ timeoutMs: -100 }, "/path").timeoutMs).toBe(-100);
    expect(parseConfig({ timeoutMs: 0 }, "/path").timeoutMs).toBe(0);
  });

  it("normalizes protocol version whitespace", () => {
    const raw = { protocolVersion: "  2025-01-01  " };
    expect(parseConfig(raw, "/path").protocolVersion).toBe("2025-01-01");
  });

  it("loads config from standard pi settings files", async () => {
    const originalHome = process.env.HOME;
    const originalCwd = process.cwd();
    const tempHome = mkdtempSync(join(tmpdir(), "pi-ref-settings-home-"));
    const tempProject = mkdtempSync(join(tmpdir(), "pi-ref-settings-project-"));

    mkdirSync(join(tempHome, ".pi", "agent"), { recursive: true });
    mkdirSync(join(tempProject, ".pi"), { recursive: true });

    writeFileSync(
      join(tempHome, ".pi", "agent", "settings.json"),
      JSON.stringify({ "pi-ref-tools": { timeoutMs: 1234 } }),
      "utf-8",
    );
    writeFileSync(
      join(tempProject, ".pi", "settings.json"),
      JSON.stringify({ "pi-ref-tools": { url: "https://project.example/mcp", maxLines: 99 } }),
      "utf-8",
    );

    process.env.HOME = tempHome;
    process.chdir(tempProject);
    vi.resetModules();

    try {
      const mod = await import("../extensions/index.js");
      const config = mod.loadRuntimeConfig({ getFlag: () => undefined } as never);
      expect(config?.apiKey).toBeUndefined();
      expect(config?.timeoutMs).toBe(1234);
      expect(config?.url).toBe("https://project.example/mcp");
      expect(config?.maxLines).toBe(99);
    } finally {
      process.chdir(originalCwd);
      if (originalHome) process.env.HOME = originalHome;
      else delete process.env.HOME;
    }
  });

  it("warns when a legacy config file exists but is ignored", async () => {
    const originalHome = process.env.HOME;
    const originalCwd = process.cwd();
    const tempHome = mkdtempSync(join(tmpdir(), "pi-ref-legacy-home-"));
    const tempProject = mkdtempSync(join(tmpdir(), "pi-ref-legacy-project-"));

    mkdirSync(join(tempHome, ".pi", "agent", "extensions"), { recursive: true });
    writeFileSync(
      join(tempHome, ".pi", "agent", "extensions", "ref-tools.json"),
      JSON.stringify({ apiKey: "legacy-key" }),
      "utf-8",
    );

    process.env.HOME = tempHome;
    process.chdir(tempProject);
    vi.resetModules();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const mod = await import("../extensions/index.js");
      expect(mod.loadRuntimeConfig({ getFlag: () => undefined } as never)).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Ignoring legacy config file"));
    } finally {
      warnSpy.mockRestore();
      process.chdir(originalCwd);
      if (originalHome) process.env.HOME = originalHome;
      else delete process.env.HOME;
    }
  });

  it("resolves runtime settings from flags, env, and config", () => {
    process.env.REF_MCP_URL = "https://env.example/mcp";
    process.env.REF_API_KEY = "env-key";

    const pi = {
      getFlag: vi.fn((flag: string) => {
        if (flag === "--ref-mcp-url") return "https://flag.example/mcp";
        if (flag === "--ref-mcp-timeout-ms") return "45000";
        if (flag === "--ref-mcp-protocol") return "2026-01-01";
        return undefined;
      }),
    };

    const settings = resolveRuntimeSettings(pi as never);
    expect(settings.endpoint).toBe("https://flag.example/mcp");
    expect(settings.apiKey).toBe("env-key");
    expect(settings.apiKeySource).toBe("REF_API_KEY env var");
    expect(settings.timeoutMs).toBe(45000);
    expect(settings.protocolVersion).toBe("2026-01-01");
  });

  it("formats session start messages", () => {
    expect(
      formatSessionStartMessage({
        config: null,
        endpoint: "https://docs.example.test/mcp",
        apiKey: "secret",
        apiKeySource: "config file",
        maxBytes: 1,
        maxLines: 1,
        timeoutMs: 1,
        protocolVersion: "2025-06-18",
      }),
    ).toBe("[ref-tools] Connected to https://docs.example.test/mcp (API key: config file)");

    expect(
      formatSessionStartMessage({
        config: null,
        endpoint: "https://docs.example.test/mcp",
        maxBytes: 1,
        maxLines: 1,
        timeoutMs: 1,
        protocolVersion: "2025-06-18",
      }),
    ).toContain("No API key configured");
  });
});
