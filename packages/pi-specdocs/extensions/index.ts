/**
 * Specdocs Extension for pi
 *
 * SessionStart hook: scans docs/prd, docs/adr, and docs/architecture directories
 * and displays a summary of existing spec documents so the model has immediate
 * awareness of what exists.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// =============================================================================
// Constants
// =============================================================================

const CONFIG_PATH = ".claude/tracker.md";
const PRD_DIR = "docs/prd";
const ADR_DIR = "docs/adr";
const PLAN_DIR = "docs/architecture";

const PRD_PATTERN = /^PRD-\d{3}-.*\.md$/;
const ADR_PATTERN = /^ADR-\d{4}-.*\.md$/;
const PLAN_PATTERN = /^plan-.*\.md$/;

// =============================================================================
// Config Functions
// =============================================================================

interface TrackerConfig {
	[key: string]: string;
}

function readConfig(cwd: string): TrackerConfig {
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

function formatConfig(config: TrackerConfig): string {
	const lines: string[] = [];

	let tracker = config.tracker || "github";
	if (tracker !== "github" && tracker !== "linear") {
		lines.push(`[specdocs] WARNING: unknown tracker '${tracker}' in ${CONFIG_PATH} — defaulting to github`);
		tracker = "github";
	}

	let trackerInfo = `Tracker: ${tracker}`;
	if (tracker === "linear") {
		const team = config["linear-team"] || "";
		if (team) {
			trackerInfo += ` (team: ${team})`;
		} else {
			lines.push(`[specdocs] WARNING: tracker=linear but linear-team is not set in ${CONFIG_PATH}`);
		}
	} else if (tracker === "github" && Object.keys(config).length === 0) {
		trackerInfo += " (default)";
	}

	const notionSync = (config["notion-sync"] || "false").toLowerCase() === "true";
	const notionInfo = notionSync ? "Notion sync: enabled" : "Notion sync: disabled";

	if (notionSync) {
		if (!config["notion-prd-database"]) {
			lines.push(`[specdocs] WARNING: notion-sync=true but notion-prd-database is not set in ${CONFIG_PATH}`);
		}
		if (!config["notion-adr-database"]) {
			lines.push(`[specdocs] WARNING: notion-sync=true but notion-adr-database is not set in ${CONFIG_PATH}`);
		}
	}

	if (Object.keys(config).length === 0) {
		lines.push(`[specdocs] ${trackerInfo} | ${notionInfo}`);
		lines.push("[specdocs] No config found. Any tracker-aware skill or command will prompt for setup on first use.");
	} else {
		lines.push(`[specdocs] ${trackerInfo} | ${notionInfo}`);
	}

	return lines.join("\n");
}

// =============================================================================
// Scanner Functions
// =============================================================================

function listMatchingFiles(directory: string, pattern: RegExp): string[] {
	if (!existsSync(directory)) {
		return [];
	}
	try {
		return readdirSync(directory)
			.filter((f) => pattern.test(f))
			.sort();
	} catch {
		return [];
	}
}

function extractFrontmatterField(filepath: string, field: string): string {
	try {
		const content = readFileSync(filepath, "utf-8");
		const lines = content.split("\n");

		if (lines.length === 0 || lines[0].trim() !== "---") {
			return "";
		}

		for (let i = 1; i < lines.length; i++) {
			if (lines[i].trim() === "---") {
				break;
			}
			if (lines[i].startsWith(`${field}:`)) {
				return lines[i]
					.split(":", 2)[1]
					.trim()
					.replace(/^["']|["']$/g, "");
			}
		}
	} catch {
		// Ignore read errors
	}
	return "";
}

interface ScanResult {
	prdFiles: string[];
	adrFiles: string[];
	planFiles: string[];
	proposedAdrs: string[];
	draftPrds: string[];
}

function scanWorkspace(cwd: string): ScanResult {
	const prdDir = join(cwd, PRD_DIR);
	const adrDir = join(cwd, ADR_DIR);
	const planDir = join(cwd, PLAN_DIR);

	const prdFiles = listMatchingFiles(prdDir, PRD_PATTERN);
	const adrFiles = listMatchingFiles(adrDir, ADR_PATTERN);
	const planFiles = listMatchingFiles(planDir, PLAN_PATTERN);

	const proposedAdrs: string[] = [];
	for (const filename of adrFiles) {
		const filepath = join(adrDir, filename);
		const status = extractFrontmatterField(filepath, "status");
		if (status === "Proposed") {
			const title = extractFrontmatterField(filepath, "title") || filename;
			proposedAdrs.push(title);
		}
	}

	const draftPrds: string[] = [];
	for (const filename of prdFiles) {
		const filepath = join(prdDir, filename);
		const status = extractFrontmatterField(filepath, "status");
		if (status === "Draft") {
			const title = extractFrontmatterField(filepath, "title") || filename;
			draftPrds.push(title);
		}
	}

	return { prdFiles, adrFiles, planFiles, proposedAdrs, draftPrds };
}

function formatSummary(result: ScanResult): string | null {
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

// =============================================================================
// Exports (for testing)
// =============================================================================

export { extractFrontmatterField, formatConfig, formatSummary, listMatchingFiles, readConfig, scanWorkspace };

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function specdocs(pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		const cwd = process.cwd();

		const config = readConfig(cwd);
		console.log(formatConfig(config));

		const result = scanWorkspace(cwd);
		const summary = formatSummary(result);
		if (summary) {
			console.log(summary);
		}
	});
}
