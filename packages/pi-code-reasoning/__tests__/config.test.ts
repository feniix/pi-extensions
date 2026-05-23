import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../extensions/config.js";

const originalHome = process.env.HOME;
const originalConfigFile = process.env.CODE_REASONING_CONFIG_FILE;
const originalLegacyConfig = process.env.CODE_REASONING_CONFIG;

const tempDirs: string[] = [];

function makeTempDir(): string {
  const path = mkdtempSync(join(tmpdir(), "pi-code-reasoning-config-"));
  tempDirs.push(path);
  return path;
}

function clearConfigEnv(): void {
  delete process.env.CODE_REASONING_CONFIG_FILE;
  delete process.env.CODE_REASONING_CONFIG;
}

afterEach(() => {
  vi.restoreAllMocks();
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  if (originalConfigFile === undefined) {
    delete process.env.CODE_REASONING_CONFIG_FILE;
  } else {
    process.env.CODE_REASONING_CONFIG_FILE = originalConfigFile;
  }
  if (originalLegacyConfig === undefined) {
    delete process.env.CODE_REASONING_CONFIG;
  } else {
    process.env.CODE_REASONING_CONFIG = originalLegacyConfig;
  }

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadConfig", () => {
  it("returns null for a missing explicit config file", () => {
    const dir = makeTempDir();

    expect(loadConfig(join(dir, "missing.json"))).toBeNull();
  });

  it("warns and returns null for malformed explicit config JSON", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const dir = makeTempDir();
    const path = join(dir, "config.json");
    writeFileSync(path, "{", "utf-8");

    expect(loadConfig(path)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Failed to parse config"));
  });

  it("warns and returns null for invalid explicit config shape", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const dir = makeTempDir();
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify("invalid"), "utf-8");

    expect(loadConfig(path)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Invalid Code Reasoning config"));
  });

  it("loads an explicit config file and normalizes numeric strings", () => {
    const dir = makeTempDir();
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ maxBytes: "1024", maxLines: "50" }), "utf-8");

    expect(loadConfig(path)).toEqual({ maxBytes: 1024, maxLines: 50 });
  });

  it("loads CODE_REASONING_CONFIG_FILE when no explicit path is passed", () => {
    const dir = makeTempDir();
    const path = join(dir, "env-config.json");
    writeFileSync(path, JSON.stringify({ maxBytes: 2048, maxLines: 75 }), "utf-8");
    process.env.CODE_REASONING_CONFIG_FILE = path;
    delete process.env.CODE_REASONING_CONFIG;

    expect(loadConfig(undefined)).toEqual({ maxBytes: 2048, maxLines: 75 });
  });

  it("loads deprecated CODE_REASONING_CONFIG and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const dir = makeTempDir();
    const path = join(dir, "legacy-env-config.json");
    writeFileSync(path, JSON.stringify({ maxBytes: 4096 }), "utf-8");
    delete process.env.CODE_REASONING_CONFIG_FILE;
    process.env.CODE_REASONING_CONFIG = path;

    expect(loadConfig(undefined)).toEqual({ maxBytes: 4096, maxLines: undefined });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("CODE_REASONING_CONFIG is deprecated"));
  });

  it("returns null when no config sources exist", () => {
    const home = makeTempDir();
    const project = makeTempDir();
    clearConfigEnv();
    process.env.HOME = home;
    vi.spyOn(process, "cwd").mockReturnValue(project);

    expect(loadConfig(undefined)).toBeNull();
  });

  it("ignores settings files without object config", () => {
    const home = makeTempDir();
    const project = makeTempDir();
    mkdirSync(join(project, ".pi"), { recursive: true });
    writeFileSync(join(project, ".pi", "settings.json"), JSON.stringify({ "pi-code-reasoning": "invalid" }), "utf-8");
    clearConfigEnv();
    process.env.HOME = home;
    vi.spyOn(process, "cwd").mockReturnValue(project);

    expect(loadConfig(undefined)).toBeNull();
  });

  it("ignores malformed settings JSON", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const home = makeTempDir();
    const project = makeTempDir();
    mkdirSync(join(project, ".pi"), { recursive: true });
    writeFileSync(join(project, ".pi", "settings.json"), "{", "utf-8");
    clearConfigEnv();
    process.env.HOME = home;
    vi.spyOn(process, "cwd").mockReturnValue(project);

    expect(loadConfig(undefined)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Failed to parse settings"));
  });

  it("warns when ignored legacy config files exist", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const home = makeTempDir();
    const project = makeTempDir();
    mkdirSync(join(project, ".pi", "extensions"), { recursive: true });
    writeFileSync(join(project, ".pi", "extensions", "code-reasoning.json"), "{}", "utf-8");
    clearConfigEnv();
    process.env.HOME = home;
    vi.spyOn(process, "cwd").mockReturnValue(project);

    expect(loadConfig(undefined)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Ignoring legacy config file"));
  });

  it("merges project settings over global settings", () => {
    const home = makeTempDir();
    const project = makeTempDir();
    const globalSettingsDir = join(home, ".pi", "agent");
    const projectSettingsDir = join(project, ".pi");
    mkdirSync(globalSettingsDir, { recursive: true });
    mkdirSync(projectSettingsDir, { recursive: true });
    writeFileSync(
      join(globalSettingsDir, "settings.json"),
      JSON.stringify({ "pi-code-reasoning": { maxBytes: 1000, maxLines: 100 } }),
      "utf-8",
    );
    writeFileSync(
      join(projectSettingsDir, "settings.json"),
      JSON.stringify({ "pi-code-reasoning": { maxLines: 25 } }),
      "utf-8",
    );

    clearConfigEnv();
    process.env.HOME = home;
    vi.spyOn(process, "cwd").mockReturnValue(project);

    expect(loadConfig(undefined)).toEqual({ maxBytes: 1000, maxLines: 25 });
  });

  it("falls back to global maxLines when project only sets maxBytes", () => {
    const home = makeTempDir();
    const project = makeTempDir();
    const globalSettingsDir = join(home, ".pi", "agent");
    const projectSettingsDir = join(project, ".pi");
    mkdirSync(globalSettingsDir, { recursive: true });
    mkdirSync(projectSettingsDir, { recursive: true });
    writeFileSync(
      join(globalSettingsDir, "settings.json"),
      JSON.stringify({ "pi-code-reasoning": { maxBytes: 1000, maxLines: 100 } }),
      "utf-8",
    );
    writeFileSync(
      join(projectSettingsDir, "settings.json"),
      JSON.stringify({ "pi-code-reasoning": { maxBytes: 2500 } }),
      "utf-8",
    );

    clearConfigEnv();
    process.env.HOME = home;
    vi.spyOn(process, "cwd").mockReturnValue(project);

    expect(loadConfig(undefined)).toEqual({ maxBytes: 2500, maxLines: 100 });
  });
});
