import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { ADR_FILENAME_PATTERN, isAdr, isPrd, PRD_FILENAME_PATTERN, validateFrontmatter } from "./spec-validation.js";
import { ADR_DIR, listMatchingFiles, PRD_DIR } from "./workspace-scan.js";

function extractFilePath(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  return (input.file_path as string) || (input.path as string) || "";
}

export async function handleDocLint(
  event: { toolName: string; input?: Record<string, unknown> },
  ctx: ExtensionContext,
) {
  if (event.toolName !== "write" && event.toolName !== "edit") {
    return;
  }

  const filePath = extractFilePath(event.input);
  if (!filePath || (!isPrd(filePath) && !isAdr(filePath)) || !existsSync(filePath)) {
    return;
  }

  const warnings = validateFrontmatter(filePath);
  if (warnings.length > 0) {
    ctx.ui.notify(`[specdocs] Frontmatter warnings:\n${warnings.join("\n")}`, "warning");
  }
}

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

export async function runValidation(ctx: { cwd: string } & ExtensionContext) {
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
