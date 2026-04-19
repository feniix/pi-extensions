import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultPalette } from "./palette.js";
import type { StatuslineConfig, StatuslinePalette, StatuslinePaletteInput } from "./types.js";

const STATUSLINE_CONFIG_KEY = "pi-statusline";
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isValidHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value);
}

export function sanitizePaletteInput(input: StatuslinePaletteInput | null | undefined): Partial<StatuslinePalette> {
  if (!input || typeof input !== "object") {
    return {};
  }

  const sanitized: Partial<StatuslinePalette> = {};
  for (const key of Object.keys(defaultPalette) as Array<keyof StatuslinePalette>) {
    const value = input[key];
    if (isValidHexColor(value)) {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

export function resolvePalette(
  globalConfig: StatuslineConfig | null | undefined,
  projectConfig: StatuslineConfig | null | undefined,
): StatuslinePalette {
  return {
    ...defaultPalette,
    ...sanitizePaletteInput(globalConfig?.palette),
    ...sanitizePaletteInput(projectConfig?.palette),
  };
}

export function getStatuslineConfigPaths(
  cwd: string,
  homeDir = homedir(),
): { globalPath: string; projectPath: string } {
  return {
    globalPath: join(homeDir, ".pi", "agent", "settings.json"),
    projectPath: join(cwd, ".pi", "settings.json"),
  };
}

export function extractStatuslineConfig(settings: unknown): StatuslineConfig | null {
  if (!settings || typeof settings !== "object") {
    return null;
  }

  const config = (settings as Record<string, unknown>)[STATUSLINE_CONFIG_KEY];
  if (!config || typeof config !== "object") {
    return null;
  }

  return config as StatuslineConfig;
}

async function readSettingsFile(path: string): Promise<unknown | null> {
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ENOENT")) {
      return null;
    }

    console.warn(`[pi-statusline] Failed to read settings from ${path}: ${message}`);
    return null;
  }
}

export async function loadStatuslinePalette(cwd: string, homeDir = homedir()): Promise<StatuslinePalette> {
  const { globalPath, projectPath } = getStatuslineConfigPaths(cwd, homeDir);
  const [globalSettings, projectSettings] = await Promise.all([
    readSettingsFile(globalPath),
    readSettingsFile(projectPath),
  ]);

  return resolvePalette(extractStatuslineConfig(globalSettings), extractStatuslineConfig(projectSettings));
}
