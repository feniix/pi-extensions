import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractFrontmatterField } from "./frontmatter.js";

export const CONFIG_PATH = ".claude/tracker.md";
export const PRD_DIR = "docs/prd";
export const ADR_DIR = "docs/adr";
export const PLAN_DIR = "docs/architecture";

const SCAN_PRD_PATTERN = /^PRD-\d{3}-.*\.md$/;
const SCAN_ADR_PATTERN = /^ADR-\d{4}-.*\.md$/;
const SCAN_PLAN_PATTERN = /^plan-.*\.md$/;

interface TrackerConfig {
  [key: string]: string;
}

export interface ScanResult {
  prdFiles: string[];
  adrFiles: string[];
  planFiles: string[];
  proposedAdrs: string[];
  draftPrds: string[];
}

export function readConfig(cwd: string): TrackerConfig {
  const configPath = join(cwd, CONFIG_PATH);
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    const lines = content.split("\n");

    if (lines.length === 0 || lines[0].trim() !== "---") {
      return {};
    }

    const config: TrackerConfig = {};
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        break;
      }
      if (lines[i].includes(":")) {
        const colonIdx = lines[i].indexOf(":");
        const key = lines[i].slice(0, colonIdx).trim();
        const value = lines[i]
          .slice(colonIdx + 1)
          .trim()
          .replace(/^["']|["']$/g, "");
        config[key] = value;
      }
    }
    return config;
  } catch {
    return {};
  }
}

function resolveTracker(config: TrackerConfig): { tracker: "github" | "linear"; warning?: string } {
  const tracker = config.tracker || "github";
  if (tracker === "github" || tracker === "linear") {
    return { tracker };
  }

  return {
    tracker: "github",
    warning: `[specdocs] WARNING: unknown tracker '${tracker}' in ${CONFIG_PATH} — defaulting to github`,
  };
}

function formatTrackerInfo(tracker: "github" | "linear", config: TrackerConfig): { info: string; warnings: string[] } {
  const warnings: string[] = [];
  let info = `Tracker: ${tracker}`;

  if (tracker === "linear") {
    const team = config["linear-team"] || "";
    if (team) {
      info += ` (team: ${team})`;
    } else {
      warnings.push(`[specdocs] WARNING: tracker=linear but linear-team is not set in ${CONFIG_PATH}`);
    }
  } else if (Object.keys(config).length === 0) {
    info += " (default)";
  }

  return { info, warnings };
}

function getNotionConfigInfo(config: TrackerConfig): { info: string; warnings: string[] } {
  const notionSync = (config["notion-sync"] || "false").toLowerCase() === "true";
  const warnings: string[] = [];

  if (notionSync && !config["notion-prd-database"]) {
    warnings.push(`[specdocs] WARNING: notion-sync=true but notion-prd-database is not set in ${CONFIG_PATH}`);
  }

  if (notionSync && !config["notion-adr-database"]) {
    warnings.push(`[specdocs] WARNING: notion-sync=true but notion-adr-database is not set in ${CONFIG_PATH}`);
  }

  return {
    info: notionSync ? "Notion sync: enabled" : "Notion sync: disabled",
    warnings,
  };
}

export function formatConfig(config: TrackerConfig): string {
  const lines: string[] = [];
  const hasConfig = Object.keys(config).length > 0;
  const { tracker, warning: trackerWarning } = resolveTracker(config);
  const trackerInfo = formatTrackerInfo(tracker, config);
  const notionInfo = getNotionConfigInfo(config);

  if (trackerWarning) {
    lines.push(trackerWarning);
  }
  lines.push(...trackerInfo.warnings, ...notionInfo.warnings);
  lines.push(`[specdocs] ${trackerInfo.info} | ${notionInfo.info}`);

  if (!hasConfig) {
    lines.push("[specdocs] No config found. Any tracker-aware skill or command will prompt for setup on first use.");
  }

  return lines.join("\n");
}

export function listMatchingFiles(directory: string, pattern: RegExp): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  try {
    return readdirSync(directory)
      .filter((filename) => pattern.test(filename))
      .sort();
  } catch {
    return [];
  }
}

function collectDocumentsWithStatus(directory: string, filenames: string[], statusFieldValue: string): string[] {
  const matches: string[] = [];

  for (const filename of filenames) {
    const filepath = join(directory, filename);
    const status = extractFrontmatterField(filepath, "status");
    if (status === statusFieldValue) {
      const title = extractFrontmatterField(filepath, "title") || filename;
      matches.push(title);
    }
  }

  return matches;
}

export function scanWorkspace(cwd: string): ScanResult {
  const prdDir = join(cwd, PRD_DIR);
  const adrDir = join(cwd, ADR_DIR);
  const planDir = join(cwd, PLAN_DIR);

  const prdFiles = listMatchingFiles(prdDir, SCAN_PRD_PATTERN);
  const adrFiles = listMatchingFiles(adrDir, SCAN_ADR_PATTERN);
  const planFiles = listMatchingFiles(planDir, SCAN_PLAN_PATTERN);

  return {
    prdFiles,
    adrFiles,
    planFiles,
    proposedAdrs: collectDocumentsWithStatus(adrDir, adrFiles, "Proposed"),
    draftPrds: collectDocumentsWithStatus(prdDir, prdFiles, "Draft"),
  };
}

export function formatSummary(result: ScanResult): string | null {
  const { prdFiles, adrFiles, planFiles, proposedAdrs, draftPrds } = result;

  if (prdFiles.length === 0 && adrFiles.length === 0 && planFiles.length === 0) {
    return null;
  }

  const lines: string[] = [];
  lines.push(`[specdocs] Workspace: ${prdFiles.length} PRDs, ${adrFiles.length} ADRs, ${planFiles.length} plans`);

  if (proposedAdrs.length > 0) {
    lines.push("[specdocs] Proposed ADRs needing review:");
    for (const title of proposedAdrs) {
      lines.push(`  - ${title}`);
    }
  }

  if (draftPrds.length > 0) {
    lines.push("[specdocs] Draft PRDs:");
    for (const title of draftPrds) {
      lines.push(`  - ${title}`);
    }
  }

  return lines.join("\n");
}
