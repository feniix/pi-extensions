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

const PRD_DIR = "docs/prd";
const ADR_DIR = "docs/adr";
const PLAN_DIR = "docs/architecture";

const PRD_PATTERN = /^PRD-\d{3}-.*\.md$/;
const ADR_PATTERN = /^ADR-\d{4}-.*\.md$/;
const PLAN_PATTERN = /^plan-.*\.md$/;

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

export { extractFrontmatterField, formatSummary, listMatchingFiles, scanWorkspace };

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function specdocs(pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		const cwd = process.cwd();
		const result = scanWorkspace(cwd);
		const summary = formatSummary(result);
		if (summary) {
			console.log(summary);
		}
	});
}
