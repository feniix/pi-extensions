import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractStatuslineConfig,
  getStatuslineConfigPaths,
  isValidHexColor,
  loadStatuslinePalette,
  resolvePalette,
  sanitizePaletteInput,
} from "../extensions/config.js";
import { defaultPalette } from "../extensions/palette.js";

const tempDirs: string[] = [];

async function createTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "pi-statusline-config-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })));
});

describe("pi-statusline config helpers", () => {
  it("validates hex colors", () => {
    expect(isValidHexColor("#008787")).toBe(true);
    expect(isValidHexColor("#abc")).toBe(false);
    expect(isValidHexColor("teal")).toBe(false);
  });

  it("sanitizes palette input", () => {
    expect(sanitizePaletteInput({ model: "#008787", repo: "bad", extra: "#ffffff" } as never)).toEqual({
      model: "#008787",
    });
  });

  it("extracts the statusline config namespace", () => {
    expect(extractStatuslineConfig({ "pi-statusline": { palette: { model: "#008787" } } })).toEqual({
      palette: { model: "#008787" },
    });
    expect(extractStatuslineConfig({})).toBeNull();
  });

  it("resolves project palette overrides over global and default values", () => {
    const palette = resolvePalette(
      { palette: { model: "#111111", repo: "#222222" } },
      { palette: { repo: "#333333", activity: "#444444" } },
    );

    expect(palette.model).toBe("#111111");
    expect(palette.repo).toBe("#333333");
    expect(palette.activity).toBe("#444444");
    expect(palette.thinking).toBe(defaultPalette.thinking);
  });

  it("returns standard global and project config paths", () => {
    expect(getStatuslineConfigPaths("/tmp/project", "/tmp/home")).toEqual({
      globalPath: "/tmp/home/.pi/agent/settings.json",
      projectPath: "/tmp/project/.pi/settings.json",
    });
  });

  it("loads palette overrides from settings files", async () => {
    const homeDir = await createTempDir();
    const cwd = await createTempDir();

    await mkdir(join(homeDir, ".pi", "agent"), { recursive: true });
    await mkdir(join(cwd, ".pi"), { recursive: true });

    await writeFile(
      join(homeDir, ".pi", "agent", "settings.json"),
      JSON.stringify({ "pi-statusline": { palette: { model: "#111111", repo: "#222222" } } }),
    );
    await writeFile(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({ "pi-statusline": { palette: { repo: "#333333", activity: "#444444" } } }),
    );

    const palette = await loadStatuslinePalette(cwd, homeDir);

    expect(palette.model).toBe("#111111");
    expect(palette.repo).toBe("#333333");
    expect(palette.activity).toBe("#444444");
  });

  it("ignores invalid settings and warns once per bad file", async () => {
    const homeDir = await createTempDir();
    const cwd = await createTempDir();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await mkdir(join(homeDir, ".pi", "agent"), { recursive: true });
    await mkdir(join(cwd, ".pi"), { recursive: true });

    await writeFile(join(homeDir, ".pi", "agent", "settings.json"), "{not-json");
    await writeFile(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({ "pi-statusline": { palette: { model: "bad", activity: "#444444" } } }),
    );

    const palette = await loadStatuslinePalette(cwd, homeDir);

    expect(palette.model).toBe(defaultPalette.model);
    expect(palette.activity).toBe("#444444");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
