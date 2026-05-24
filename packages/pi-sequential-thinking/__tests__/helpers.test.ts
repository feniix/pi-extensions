import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatToolOutput,
  isRecord,
  loadConfigWithSources,
  normalizeNumber,
  normalizeString,
  parseConfig,
  resolveConfigPath,
  resolveEffectiveConfig,
  resolveEffectiveLimits,
  splitParams,
  toJsonString,
  writeTempFile,
} from "../extensions/index.js";

describe("pi-sequential-thinking helpers", () => {
  it("resolves effective config values with source labels", () => {
    const effective = resolveEffectiveConfig({
      flags: { storageDir: "/flag/storage", maxBytes: "1000" },
      env: { MCP_STORAGE_DIR: "/env/storage", SEQ_THINK_MAX_BYTES: "2000", SEQ_THINK_MAX_LINES: "3000" },
      config: {
        config: { storageDir: "/config/storage", maxBytes: 111, maxLines: 222 },
        sources: { storageDir: "project_settings", maxBytes: "global_settings", maxLines: "config_file" },
      },
    });

    expect(effective).toEqual({
      storageDir: "/flag/storage",
      maxBytes: 1000,
      maxLines: 3000,
      sources: { storageDir: "flag", maxBytes: "flag", maxLines: "env" },
    });
  });

  it("falls back to config and defaults in effective config", () => {
    const effective = resolveEffectiveConfig({
      flags: {},
      env: {},
      config: { config: { storageDir: "/project/storage" }, sources: { storageDir: "project_settings" } },
    });

    expect(effective).toEqual({
      storageDir: "/project/storage",
      maxBytes: 51200,
      maxLines: 2000,
      sources: { storageDir: "project_settings", maxBytes: "default", maxLines: "default" },
    });
  });

  it("splits params and clamps limits", () => {
    const { toolArgs, requestedLimits } = splitParams({
      piMaxBytes: "100",
      piMaxLines: 5,
      thought: "hello",
      thought_number: 1,
      total_thoughts: 3,
      next_thought_needed: true,
      stage: "Analysis",
    });
    expect(toolArgs).toEqual({
      thought: "hello",
      thought_number: 1,
      total_thoughts: 3,
      next_thought_needed: true,
      stage: "Analysis",
    });
    expect(requestedLimits).toEqual({ maxBytes: 100, maxLines: 5 });

    const effective = resolveEffectiveLimits({ maxBytes: 200, maxLines: 2 }, { maxBytes: 120, maxLines: 10 });
    expect(effective).toEqual({ maxBytes: 120, maxLines: 2 });
  });

  it("resolves effective limits using defaults when not requested", () => {
    const effective = resolveEffectiveLimits({}, { maxBytes: 51200, maxLines: 2000 });
    expect(effective).toEqual({ maxBytes: 51200, maxLines: 2000 });
  });

  it("normalizes numbers from strings and numbers", () => {
    expect(normalizeNumber(42)).toBe(42);
    expect(normalizeNumber("123")).toBe(123);
    expect(normalizeNumber("abc")).toBeUndefined();
    expect(normalizeNumber(null)).toBeUndefined();
    expect(normalizeNumber(undefined)).toBeUndefined();
    expect(normalizeNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it("loads config from standard pi settings files", async () => {
    const originalHome = process.env.HOME;
    const originalCwd = process.cwd();
    const tempHome = mkdtempSync(join(tmpdir(), "pi-seq-think-settings-home-"));
    const tempProject = mkdtempSync(join(tmpdir(), "pi-seq-think-settings-project-"));

    const globalSettingsDir = join(tempHome, ".pi", "agent");
    const projectSettingsDir = join(tempProject, ".pi");

    mkdirSync(globalSettingsDir, { recursive: true });
    mkdirSync(projectSettingsDir, { recursive: true });

    writeFileSync(
      join(globalSettingsDir, "settings.json"),
      JSON.stringify({ "pi-sequential-thinking": { maxBytes: 111 } }),
      "utf-8",
    );
    writeFileSync(
      join(projectSettingsDir, "settings.json"),
      JSON.stringify({ "pi-sequential-thinking": { storageDir: "/tmp/thoughts", maxLines: 22 } }),
      "utf-8",
    );

    process.env.HOME = tempHome;
    process.chdir(tempProject);
    vi.resetModules();

    try {
      const mod = await import("../extensions/index.js");
      expect(mod.loadConfigWithSources(undefined)?.config).toEqual({
        storageDir: "/tmp/thoughts",
        maxBytes: 111,
        maxLines: 22,
      });
    } finally {
      process.chdir(originalCwd);
      if (originalHome) process.env.HOME = originalHome;
      else delete process.env.HOME;
    }
  });

  it("warns when a legacy config file exists but is ignored", async () => {
    const originalHome = process.env.HOME;
    const originalCwd = process.cwd();
    const tempHome = mkdtempSync(join(tmpdir(), "pi-seq-think-legacy-home-"));
    const tempProject = mkdtempSync(join(tmpdir(), "pi-seq-think-legacy-project-"));

    mkdirSync(join(tempHome, ".pi", "agent", "extensions"), { recursive: true });
    writeFileSync(
      join(tempHome, ".pi", "agent", "extensions", "sequential-thinking.json"),
      JSON.stringify({ maxBytes: 111 }),
      "utf-8",
    );

    process.env.HOME = tempHome;
    process.chdir(tempProject);
    vi.resetModules();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const mod = await import("../extensions/index.js");
      expect(mod.loadConfigWithSources(undefined)).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Ignoring legacy config file"));
    } finally {
      warnSpy.mockRestore();
      process.chdir(originalCwd);
      if (originalHome) process.env.HOME = originalHome;
      else delete process.env.HOME;
    }
  });
});

describe("pi-sequential-thinking type guards", () => {
  it("isRecord returns true for plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it("isRecord returns false for non-objects", () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord("string")).toBe(false);
    expect(isRecord(123)).toBe(false);
    expect(isRecord([])).toBe(false);
  });
});

describe("pi-sequential-thinking toJsonString", () => {
  it("returns strings as-is", () => {
    expect(toJsonString("hello")).toBe("hello");
    expect(toJsonString("")).toBe("");
  });

  it("stringifies objects", () => {
    const result = toJsonString({ a: 1, b: 2 });
    expect(JSON.parse(result)).toEqual({ a: 1, b: 2 });
  });

  it("converts primitives", () => {
    expect(toJsonString(42)).toBe("42");
    expect(toJsonString(true)).toBe("true");
    expect(toJsonString(null)).toBe("null");
  });
});

describe("pi-sequential-thinking normalizeString", () => {
  it("returns trimmed strings", () => {
    expect(normalizeString("  hello  ")).toBe("hello");
    expect(normalizeString("test")).toBe("test");
  });

  it("returns undefined for empty/whitespace strings", () => {
    expect(normalizeString("")).toBeUndefined();
    expect(normalizeString("   ")).toBeUndefined();
  });

  it("returns undefined for non-strings", () => {
    expect(normalizeString(123)).toBeUndefined();
    expect(normalizeString(null)).toBeUndefined();
    expect(normalizeString(undefined)).toBeUndefined();
  });
});

describe("pi-sequential-thinking resolveConfigPath", () => {
  it("resolves paths starting with ~/", () => {
    const result = resolveConfigPath("~/.pi/config.json");
    expect(result).toContain(homedir());
    expect(result).toContain(".pi/config.json");
  });

  it("resolves bare-tilde paths (no slash) by joining to home", () => {
    // Exercises the `startsWith("~")` branch, which the `~/...` test above
    // never reaches because `startsWith("~/")` matches first.
    const result = resolveConfigPath("~thoughts.json");
    expect(result).toBe(join(homedir(), "thoughts.json"));
  });

  it("returns absolute paths as-is", () => {
    const absolute = "/absolute/path/to/config.json";
    expect(resolveConfigPath(absolute)).toBe(absolute);
  });

  it("resolves effective home-relative storage directories", () => {
    expect(resolveEffectiveConfig({ flags: { storageDir: "~/.seq-think-flag" } }).storageDir).toBe(
      join(homedir(), ".seq-think-flag"),
    );
    expect(resolveEffectiveConfig({ env: { MCP_STORAGE_DIR: "~/.seq-think-env" } }).storageDir).toBe(
      join(homedir(), ".seq-think-env"),
    );
    expect(
      resolveEffectiveConfig({
        config: { config: { storageDir: "~/.seq-think-config" }, sources: { storageDir: "project_settings" } },
      }).storageDir,
    ).toBe(join(homedir(), ".seq-think-config"));
  });

  it("resolves relative paths from cwd", () => {
    const result = resolveConfigPath("relative/path.json");
    expect(result).toBe(resolve(process.cwd(), "relative/path.json"));
  });
});

describe("pi-sequential-thinking loadConfigWithSources", () => {
  it("returns null when no config exists", () => {
    const base = mkdtempSync(join(tmpdir(), "pi-seq-think-load-"));
    const configPath = join(base, "nonexistent.json");
    expect(loadConfigWithSources(configPath)).toBeNull();
  });

  it("loads valid config file", () => {
    const base = mkdtempSync(join(tmpdir(), "pi-seq-think-load-valid-"));
    const configPath = join(base, "seq-think.json");
    writeFileSync(configPath, JSON.stringify({ storageDir: "/custom", maxBytes: 123 }), "utf-8");

    expect(loadConfigWithSources(configPath)?.config).toEqual({
      storageDir: "/custom",
      maxBytes: 123,
      maxLines: undefined,
    });
  });

  it("returns null on invalid JSON", () => {
    const base = mkdtempSync(join(tmpdir(), "pi-seq-think-load-invalid-"));
    const configPath = join(base, "invalid.json");
    writeFileSync(configPath, "not valid json", "utf-8");

    expect(loadConfigWithSources(configPath)).toBeNull();
  });
});

describe("pi-sequential-thinking parseConfig", () => {
  it("parses valid config", () => {
    const raw = {
      storageDir: "/custom/storage",
      maxBytes: 1024,
      maxLines: 500,
    };
    const result = parseConfig(raw, "/path/to/config.json");
    expect(result).toEqual({
      storageDir: "/custom/storage",
      maxBytes: 1024,
      maxLines: 500,
    });
  });

  it("normalizes string values", () => {
    const raw = { storageDir: "  /custom/storage  " };
    const result = parseConfig(raw, "/path");
    expect(result.storageDir).toBe("/custom/storage");
  });

  it("ignores null/undefined values", () => {
    const raw = { storageDir: null, maxBytes: undefined, maxLines: NaN };
    const result = parseConfig(raw, "/path");
    expect(result.storageDir).toBeUndefined();
    expect(result.maxBytes).toBeUndefined();
    expect(result.maxLines).toBeUndefined();
  });

  it("throws for non-object config", () => {
    expect(() => parseConfig(null, "/path")).toThrow("Invalid Sequential Thinking config");
    expect(() => parseConfig("string", "/path")).toThrow("Invalid Sequential Thinking config");
    expect(() => parseConfig(123, "/path")).toThrow("Invalid Sequential Thinking config");
  });
});

describe("pi-sequential-thinking formatToolOutput", () => {
  it("formats simple result", () => {
    const result = formatToolOutput("test_tool", { message: "Hello" }, { maxBytes: 50000, maxLines: 2000 });
    expect(result.text).toContain("Hello");
    expect(result.details.truncated).toBe(false);
  });

  it("handles object result", () => {
    const result = formatToolOutput("test_tool", { data: 123 }, {});
    expect(result.text).toContain("data");
    expect(result.text).toContain("123");
  });
});

describe("pi-sequential-thinking writeTempFile", () => {
  const tempFiles: string[] = [];

  afterEach(() => {
    import("node:fs").then(({ unlinkSync }) => {
      tempFiles.forEach((f) => {
        try {
          unlinkSync(f);
        } catch {
          // ignore cleanup errors
        }
      });
    });
  });

  it("writes temp file and returns path", () => {
    const path = writeTempFile("test_tool", "content here");
    expect(path).toBeDefined();
    if (!path) throw new Error("expected path");
    tempFiles.push(path);
    expect(path).toContain("pi-seq-think-test_tool");
    expect(path).toContain(".txt");
    expect(existsSync(path)).toBe(true);
  });

  it("sanitizes tool name", () => {
    const path = writeTempFile("my-tool!@#", "content");
    expect(path).toBeDefined();
    if (!path) throw new Error("expected path");
    tempFiles.push(path);
    expect(path).toContain("my-tool__");
  });

  it("produces unique paths under rapid same-ms calls", () => {
    // Date.now() alone collides if two truncations fire in the same
    // millisecond; the second write would overwrite the first. Verify the
    // filename carries enough entropy that 50 consecutive calls all land on
    // distinct paths.
    const paths = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const p = writeTempFile("rapid", `payload ${i}`);
      if (!p) throw new Error("expected path");
      tempFiles.push(p);
      paths.add(p);
    }
    expect(paths.size).toBe(50);
  });
});
