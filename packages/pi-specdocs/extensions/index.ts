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

interface DocValidationConfig {
	docType: "PRD" | "ADR";
	requiredFields: readonly string[];
	validStatuses: readonly string[];
	numberPattern: RegExp;
	numberField: "prd" | "adr";
	expectedNumberFormat: string;
}

function getDocValidationConfig(filepath: string): DocValidationConfig | null {
	if (isPrd(filepath)) {
		return {
			docType: "PRD",
			requiredFields: PRD_REQUIRED_FIELDS,
			validStatuses: PRD_VALID_STATUSES,
			numberPattern: /^PRD-\d{3}$/,
			numberField: "prd",
			expectedNumberFormat: "PRD-NNN (3-digit zero-padded)",
		};
	}

	if (isAdr(filepath)) {
		return {
			docType: "ADR",
			requiredFields: ADR_REQUIRED_FIELDS,
			validStatuses: ADR_VALID_STATUSES,
			numberPattern: /^ADR-\d{4}$/,
			numberField: "adr",
			expectedNumberFormat: "ADR-NNNN (4-digit zero-padded)",
		};
	}

	return null;
}

function collectMissingFieldWarnings(
	fields: Record<string, string>,
	config: DocValidationConfig,
	warnings: string[],
): void {
	for (const field of config.requiredFields) {
		if (!fields[field]) {
			warnings.push(`⚠ ${config.docType}: Missing required frontmatter field: ${field}`);
		}
	}
}

function collectNumberWarnings(
	fields: Record<string, string>,
	config: DocValidationConfig,
	filename: string,
	warnings: string[],
): void {
	const numberValue = fields[config.numberField] ?? "";
	if (!numberValue) {
		return;
	}

	if (!config.numberPattern.test(numberValue)) {
		warnings.push(
			`⚠ ${config.docType}: Number '${numberValue}' doesn't match expected format ${config.expectedNumberFormat}.`,
		);
	}

	if (!filename.startsWith(numberValue)) {
		warnings.push(`⚠ ${config.docType}: Frontmatter says '${numberValue}' but filename is '${filename}'.`);
	}
}

function collectStatusWarnings(fields: Record<string, string>, config: DocValidationConfig, warnings: string[]): void {
	const status = fields.status ?? "";
	if (status && !config.validStatuses.includes(status)) {
		warnings.push(`⚠ ${config.docType}: Unknown status '${status}'. Expected: ${config.validStatuses.join(", ")}.`);
	}
}

function validateFrontmatter(filepath: string): string[] {
	const config = getDocValidationConfig(filepath);
	if (!config) {
		return [];
	}

	const fields = parseFrontmatter(filepath);
	if (fields === null) {
		return [`⚠ ${config.docType}: No YAML frontmatter found.`];
	}

	const warnings: string[] = [];
	collectMissingFieldWarnings(fields, config, warnings);
	collectNumberWarnings(fields, config, basename(filepath), warnings);
	collectStatusWarnings(fields, config, warnings);
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

function formatConfig(config: TrackerConfig): string {
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

interface ValidationFiles {
	prdDir: string;
	adrDir: string;
	prdFiles: string[];
	adrFiles: string[];
}

function getValidationFiles(cwd: string): ValidationFiles {
	const prdDir = join(cwd, PRD_DIR);
	const adrDir = join(cwd, ADR_DIR);
	const planDir = join(cwd, PLAN_DIR);
	void listMatchingFiles(planDir, SCAN_PLAN_PATTERN);

	return {
		prdDir,
		adrDir,
		prdFiles: listMatchingFiles(prdDir, PRD_FILENAME_PATTERN),
		adrFiles: listMatchingFiles(adrDir, ADR_FILENAME_PATTERN),
	};
}

function toWarningIssues(messages: string[]): ValidationIssue[] {
	return messages.map((message) => ({ type: "warning", message }));
}

function collectFrontmatterIssues(files: ValidationFiles): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	for (const filename of files.prdFiles) {
		issues.push(...toWarningIssues(validateFrontmatter(join(files.prdDir, filename))));
	}

	for (const filename of files.adrFiles) {
		issues.push(...toWarningIssues(validateFrontmatter(join(files.adrDir, filename))));
	}

	return issues;
}

function listMarkdownFiles(directory: string): string[] {
	if (!existsSync(directory)) {
		return [];
	}

	try {
		return readdirSync(directory).filter((filename) => filename.endsWith(".md"));
	} catch {
		return [];
	}
}

function collectFilenameIssues(
	directory: string,
	displayDir: string,
	pattern: RegExp,
	expected: string,
): ValidationIssue[] {
	return listMarkdownFiles(directory)
		.filter((filename) => !pattern.test(filename))
		.map((filename) => ({
			type: "error" as const,
			message: `✗ ${displayDir}/${filename}: filename doesn't match ${expected} pattern`,
		}));
}

function extractDocumentNumbers(files: string[], pattern: RegExp): number[] {
	return files
		.map((filename) => {
			const match = filename.match(pattern);
			return match ? parseInt(match[1], 10) : null;
		})
		.filter((value): value is number => value !== null)
		.sort((a, b) => a - b);
}

function collectNumberingGapIssues(files: string[], pattern: RegExp, prefix: string, width: number): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const numbers = extractDocumentNumbers(files, pattern);

	for (let i = 0; i < numbers.length - 1; i++) {
		for (let gap = numbers[i] + 1; gap < numbers[i + 1]; gap++) {
			issues.push({
				type: "warning",
				message: `⚠ Numbering gap: ${prefix}-${String(gap).padStart(width, "0")} is missing`,
			});
		}
	}

	return issues;
}

function formatValidationIssues(issues: ValidationIssue[]): { message: string; level: "error" | "warning" | "info" } {
	if (issues.length === 0) {
		return { message: "[specdocs] Validation passed: no issues found.", level: "info" };
	}

	const errors = issues.filter((issue) => issue.type === "error");
	const warnings = issues.filter((issue) => issue.type === "warning");
	const lines: string[] = [];

	if (errors.length > 0) {
		lines.push(`Errors (${errors.length}):`);
		for (const error of errors) {
			lines.push(`  ${error.message}`);
		}
	}

	if (warnings.length > 0) {
		lines.push(`Warnings (${warnings.length}):`);
		for (const warning of warnings) {
			lines.push(`  ${warning.message}`);
		}
	}

	return {
		message: `[specdocs] Validation:\n${lines.join("\n")}`,
		level: errors.length > 0 ? "error" : "warning",
	};
}

async function runValidation(ctx: { cwd: string } & ExtensionContext) {
	const files = getValidationFiles(ctx.cwd);
	const issues = [
		...collectFrontmatterIssues(files),
		...collectFilenameIssues(files.prdDir, PRD_DIR, PRD_FILENAME_PATTERN, "PRD-NNN-*.md"),
		...collectFilenameIssues(files.adrDir, ADR_DIR, ADR_FILENAME_PATTERN, "ADR-NNNN-*.md"),
		...collectNumberingGapIssues(files.prdFiles, /^PRD-(\d{3})-.*\.md$/, "PRD", 3),
		...collectNumberingGapIssues(files.adrFiles, /^ADR-(\d{4})-.*\.md$/, "ADR", 4),
	];
	const result = formatValidationIssues(issues);
	ctx.ui.notify(result.message, result.level);
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
