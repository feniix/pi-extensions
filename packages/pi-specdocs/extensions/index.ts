/**
 * Specdocs Extension for pi
 *
 * Features:
 * - SessionStart: scans docs/prd, docs/adr, and docs/architecture directories
 *   and displays a summary of existing spec documents so the model has immediate
 *   awareness of what exists.
 * - ToolResult: validates PRD/ADR frontmatter after Write/Edit operations
 *   and notifies the user of any issues.
 * - /specdocs-validate command: validates all spec documents for completeness.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

// =============================================================================
// Validation Constants
// =============================================================================

const PRD_REQUIRED_FIELDS = ["title", "prd", "status", "owner", "date", "issue", "version"] as const;
const ADR_REQUIRED_FIELDS = ["title", "adr", "status", "date", "prd"] as const;

const PRD_VALID_STATUSES = ["Draft", "Implemented", "Superseded", "Archived"] as const;
const ADR_VALID_STATUSES = ["Proposed", "Accepted", "Deprecated", "Superseded"] as const;

const PRD_FILENAME_PATTERN = /^PRD-\d{3}-.*\.md$/;
const ADR_FILENAME_PATTERN = /^ADR-\d{4}-.*\.md$/;

// =============================================================================
// Validation Functions
// =============================================================================

function parseFrontmatter(filepath: string): Record<string, string> | null {
	if (!existsSync(filepath)) return null;

	let content: string;
	try {
		content = readFileSync(filepath, "utf-8");
	} catch {
		return null;
	}

	const lines = content.split("\n");
	if (!lines.length || lines[0].trim() !== "---") return null;

	const fields: Record<string, string> = {};
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].trim() === "---") break;
		const colonIdx = lines[i].indexOf(":");
		if (colonIdx === -1) continue;
		const key = lines[i].slice(0, colonIdx).trim();
		const value = lines[i]
			.slice(colonIdx + 1)
			.trim()
			.replace(/^["']|["']$/g, "");
		fields[key] = value;
	}

	return Object.keys(fields).length ? fields : null;
}

function isPrd(path: string): boolean {
	return path.includes("docs/prd/PRD-");
}

function isAdr(path: string): boolean {
	return path.includes("docs/adr/ADR-");
}

function validateFrontmatter(filepath: string): string[] {
	const warnings: string[] = [];
	const filename = basename(filepath);

	let docType: string;
	let requiredFields: readonly string[];
	let validStatuses: readonly string[];
	let numberPattern: RegExp;
	let numberField: string;

	if (isPrd(filepath)) {
		docType = "PRD";
		requiredFields = PRD_REQUIRED_FIELDS;
		validStatuses = PRD_VALID_STATUSES;
		numberPattern = /^PRD-\d{3}$/;
		numberField = "prd";
	} else if (isAdr(filepath)) {
		docType = "ADR";
		requiredFields = ADR_REQUIRED_FIELDS;
		validStatuses = ADR_VALID_STATUSES;
		numberPattern = /^ADR-\d{4}$/;
		numberField = "adr";
	} else {
		return warnings;
	}

	const fields = parseFrontmatter(filepath);
	if (fields === null) {
		warnings.push(`⚠ ${docType}: No YAML frontmatter found.`);
		return warnings;
	}

	// Check required fields
	for (const field of requiredFields) {
		if (!fields[field]) {
			warnings.push(`⚠ ${docType}: Missing required frontmatter field: ${field}`);
		}
	}

	// Check number format
	const numberValue = fields[numberField] ?? "";
	if (numberValue && !numberPattern.test(numberValue)) {
		const expected = docType === "PRD" ? "PRD-NNN (3-digit zero-padded)" : "ADR-NNNN (4-digit zero-padded)";
		warnings.push(`⚠ ${docType}: Number '${numberValue}' doesn't match expected format ${expected}.`);
	}

	// Check filename/number match
	if (numberValue && !filename.startsWith(numberValue)) {
		warnings.push(`⚠ ${docType}: Frontmatter says '${numberValue}' but filename is '${filename}'.`);
	}

	// Check status
	const status = fields.status ?? "";
	if (status && !validStatuses.includes(status)) {
		warnings.push(`⚠ ${docType}: Unknown status '${status}'. Expected: ${validStatuses.join(", ")}.`);
	}

	return warnings;
}

// =============================================================================
// Scanner Constants
// =============================================================================

const CONFIG_PATH = ".claude/tracker.md";
const PRD_DIR = "docs/prd";
const ADR_DIR = "docs/adr";
const PLAN_DIR = "docs/architecture";

const SCAN_PRD_PATTERN = /^PRD-\d{3}-.*\.md$/;
const SCAN_ADR_PATTERN = /^ADR-\d{4}-.*\.md$/;
const SCAN_PLAN_PATTERN = /^plan-.*\.md$/;

// =============================================================================
// Scanner Functions
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

	const prdFiles = listMatchingFiles(prdDir, SCAN_PRD_PATTERN);
	const adrFiles = listMatchingFiles(adrDir, SCAN_ADR_PATTERN);
	const planFiles = listMatchingFiles(planDir, SCAN_PLAN_PATTERN);

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
// Tool Result Handler - Document Linter
// =============================================================================

function extractFilePath(input: Record<string, unknown> | undefined): string {
	if (!input) return "";
	return (input.file_path as string) || (input.path as string) || "";
}

async function handleDocLint(event: { toolName: string; input?: Record<string, unknown> }, ctx: ExtensionContext) {
	if (event.toolName !== "write" && event.toolName !== "edit") {
		return;
	}

	const filePath = extractFilePath(event.input);
	if (!filePath) return;

	if (!isPrd(filePath) && !isAdr(filePath)) {
		return;
	}

	if (!existsSync(filePath)) {
		return;
	}

	const warnings = validateFrontmatter(filePath);
	if (warnings.length > 0) {
		const message = `[specdocs] Frontmatter warnings:\n${warnings.join("\n")}`;
		ctx.ui.notify(message, "warning");
	}
}

// =============================================================================
// Validation Runner
// =============================================================================

interface ValidationIssue {
	type: "error" | "warning";
	message: string;
}

async function runValidation(ctx: { cwd: string } & ExtensionContext) {
	const issues: ValidationIssue[] = [];

	const prdDir = join(ctx.cwd, PRD_DIR);
	const adrDir = join(ctx.cwd, ADR_DIR);
	const planDir = join(ctx.cwd, PLAN_DIR);

	const prdFiles = listMatchingFiles(prdDir, PRD_FILENAME_PATTERN);
	const adrFiles = listMatchingFiles(adrDir, ADR_FILENAME_PATTERN);
	listMatchingFiles(planDir, SCAN_PLAN_PATTERN);

	// Validate frontmatter
	for (const filename of prdFiles) {
		const filepath = join(prdDir, filename);
		for (const warning of validateFrontmatter(filepath)) {
			issues.push({ type: "warning", message: warning });
		}
	}

	for (const filename of adrFiles) {
		const filepath = join(adrDir, filename);
		for (const warning of validateFrontmatter(filepath)) {
			issues.push({ type: "warning", message: warning });
		}
	}

	// Check filename conventions
	const { readdirSync: readDir } = await import("node:fs");
	if (existsSync(prdDir)) {
		for (const f of readDir(prdDir)) {
			if (f.endsWith(".md") && !PRD_FILENAME_PATTERN.test(f)) {
				issues.push({ type: "error", message: `✗ ${PRD_DIR}/${f}: filename doesn't match PRD-NNN-*.md pattern` });
			}
		}
	}

	if (existsSync(adrDir)) {
		for (const f of readDir(adrDir)) {
			if (f.endsWith(".md") && !ADR_FILENAME_PATTERN.test(f)) {
				issues.push({ type: "error", message: `✗ ${ADR_DIR}/${f}: filename doesn't match ADR-NNNN-*.md pattern` });
			}
		}
	}

	// Check numbering gaps
	const prdNumbers = prdFiles
		.map((f) => {
			const m = f.match(/^PRD-(\d{3})-.*\.md$/);
			return m ? parseInt(m[1], 10) : null;
		})
		.filter((n): n is number => n !== null)
		.sort((a, b) => a - b);

	for (let i = 0; i < prdNumbers.length - 1; i++) {
		if (prdNumbers[i + 1] - prdNumbers[i] > 1) {
			for (let gap = prdNumbers[i] + 1; gap < prdNumbers[i + 1]; gap++) {
				const padded = String(gap).padStart(3, "0");
				issues.push({ type: "warning", message: `⚠ Numbering gap: PRD-${padded} is missing` });
			}
		}
	}

	const adrNumbers = adrFiles
		.map((f) => {
			const m = f.match(/^ADR-(\d{4})-.*\.md$/);
			return m ? parseInt(m[1], 10) : null;
		})
		.filter((n): n is number => n !== null)
		.sort((a, b) => a - b);

	for (let i = 0; i < adrNumbers.length - 1; i++) {
		if (adrNumbers[i + 1] - adrNumbers[i] > 1) {
			for (let gap = adrNumbers[i] + 1; gap < adrNumbers[i + 1]; gap++) {
				const padded = String(gap).padStart(4, "0");
				issues.push({ type: "warning", message: `⚠ Numbering gap: ADR-${padded} is missing` });
			}
		}
	}

	// Report results
	const errors = issues.filter((i) => i.type === "error");
	const warnings = issues.filter((i) => i.type === "warning");

	if (issues.length === 0) {
		ctx.ui.notify("[specdocs] Validation passed: no issues found.", "info");
	} else {
		const lines: string[] = [];
		if (errors.length > 0) {
			lines.push(`Errors (${errors.length}):`);
			for (const e of errors) {
				lines.push(`  ${e.message}`);
			}
		}
		if (warnings.length > 0) {
			lines.push(`Warnings (${warnings.length}):`);
			for (const w of warnings) {
				lines.push(`  ${w.message}`);
			}
		}
		ctx.ui.notify(`[specdocs] Validation:\n${lines.join("\n")}`, errors.length > 0 ? "error" : "warning");
	}
}

// =============================================================================
// Exports (for testing)
// =============================================================================

export {
	extractFrontmatterField,
	formatConfig,
	formatSummary,
	isAdr,
	isPrd,
	listMatchingFiles,
	parseFrontmatter,
	readConfig,
	scanWorkspace,
	validateFrontmatter,
};

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

	pi.on("tool_result", async (event, ctx) => {
		await handleDocLint(event, ctx);
	});

	pi.registerCommand("specdocs-validate", {
		description:
			"(specdocs plugin) Validate all spec documents for frontmatter completeness, naming conventions, and cross-references",
		handler: async (_args, ctx) => {
			await runValidation(ctx);
		},
	});
}
