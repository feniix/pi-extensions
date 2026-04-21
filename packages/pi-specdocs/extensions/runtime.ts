import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { ADR_FILENAME_PATTERN, isAdr, isPlan, isPrd, PLAN_FILENAME_PATTERN, PRD_FILENAME_PATTERN, validateFrontmatter, validateRequiredSections, validateRequiredTables } from "./spec-validation.js";
import { parseFrontmatterResult } from "./frontmatter.js";
import { ADR_DIR, listMatchingFiles, PLAN_DIR, PRD_DIR } from "./workspace-scan.js";

function extractFilePath(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  return (input.file_path as string) || (input.path as string) || "";
}

function isArchitectureMarkdown(path: string): boolean {
  return path.includes(`${PLAN_DIR}/`) && path.endsWith(".md");
}

export async function handleDocLint(
  event: { toolName: string; input?: Record<string, unknown> },
  ctx: ExtensionContext,
) {
  if (event.toolName !== "write" && event.toolName !== "edit") {
    return;
  }

  const filePath = extractFilePath(event.input);
  if (!filePath || (!isPrd(filePath) && !isAdr(filePath) && !isPlan(filePath) && !isArchitectureMarkdown(filePath)) || !existsSync(filePath)) {
    return;
  }

  const warnings = [...validateFrontmatter(filePath), ...validateRequiredSections(filePath), ...validateRequiredTables(filePath)];
  const validationFiles = typeof ctx.cwd === "string" ? getValidationFiles(ctx.cwd) : null;
  const duplicateIssues = validationFiles ? collectDuplicateValidationIssues(validationFiles, filePath) : [];
  const architectureFilenameIssues = validationFiles ? collectArchitectureFilenameIssues(validationFiles, filePath) : [];
  const messages = [
    ...warnings,
    ...duplicateIssues.map((issue) => issue.message),
    ...architectureFilenameIssues.map((issue) => issue.message),
  ];

  if (messages.length > 0) {
    ctx.ui.notify(`[specdocs] Frontmatter warnings:\n${messages.join("\n")}`, "warning");
  }
}

interface ValidationIssue {
  type: "error" | "warning";
  message: string;
}

interface ValidationFiles {
  prdDir: string;
  adrDir: string;
  planDir: string;
  prdFiles: string[];
  adrFiles: string[];
  planFiles: string[];
}

interface DuplicateDocumentIssueConfig {
  files: string[];
  pattern: RegExp;
  prefix: string;
  width: number;
  displayDir: string;
}

function getValidationFiles(cwd: string): ValidationFiles {
  const prdDir = join(cwd, PRD_DIR);
  const adrDir = join(cwd, ADR_DIR);
  const planDir = join(cwd, PLAN_DIR);

  return {
    prdDir,
    adrDir,
    planDir,
    prdFiles: listMatchingFiles(prdDir, PRD_FILENAME_PATTERN),
    adrFiles: listMatchingFiles(adrDir, ADR_FILENAME_PATTERN),
    planFiles: listMatchingFiles(planDir, PLAN_FILENAME_PATTERN),
  };
}

function toWarningIssues(messages: string[]): ValidationIssue[] {
  return messages.map((message) => ({ type: "warning", message }));
}

function collectDuplicateNumberIssues(config: DuplicateDocumentIssueConfig): ValidationIssue[] {
  const grouped = new Map<number, string[]>();

  for (const filename of config.files) {
    const match = filename.match(config.pattern);
    if (!match) {
      continue;
    }

    const number = parseInt(match[1], 10);
    const existing = grouped.get(number) ?? [];
    existing.push(`${config.displayDir}/${filename}`);
    grouped.set(number, existing);
  }

  const issues: ValidationIssue[] = [];
  for (const [number, filenames] of grouped.entries()) {
    if (filenames.length < 2) {
      continue;
    }

    issues.push({
      type: "error",
      message: `✗ Duplicate ${config.prefix} number: ${config.prefix}-${String(number).padStart(config.width, "0")} is used by ${filenames.join(", ")}`,
    });
  }

  return issues.sort((a, b) => a.message.localeCompare(b.message));
}

function collectFrontmatterIssues(files: ValidationFiles): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const filename of files.prdFiles) {
    const filepath = join(files.prdDir, filename);
    issues.push(...toWarningIssues(validateFrontmatter(filepath)));
    issues.push(...toWarningIssues(validateRequiredSections(filepath)));
    issues.push(...toWarningIssues(validateRequiredTables(filepath)));
  }

  for (const filename of files.adrFiles) {
    const filepath = join(files.adrDir, filename);
    issues.push(...toWarningIssues(validateFrontmatter(filepath)));
    issues.push(...toWarningIssues(validateRequiredSections(filepath)));
    issues.push(...toWarningIssues(validateRequiredTables(filepath)));
  }

  for (const filename of files.planFiles) {
    const filepath = join(files.planDir, filename);
    issues.push(...toWarningIssues(validateFrontmatter(filepath)));
    issues.push(...toWarningIssues(validateRequiredSections(filepath)));
    issues.push(...toWarningIssues(validateRequiredTables(filepath)));
  }

  return issues;
}

function filterIssuesForChangedFile(issues: ValidationIssue[], changedFilePath?: string): ValidationIssue[] {
  if (!changedFilePath) {
    return issues;
  }

  const changedFilename = basename(changedFilePath);
  return issues.filter((issue) => issue.message.includes(changedFilename));
}

function collectDuplicateValidationIssues(files: ValidationFiles, changedFilePath?: string): ValidationIssue[] {
  const issues = [
    ...collectDuplicateNumberIssues({
      files: files.prdFiles,
      pattern: /^PRD-(\d{3})-.*\.md$/,
      prefix: "PRD",
      width: 3,
      displayDir: PRD_DIR,
    }),
    ...collectDuplicateNumberIssues({
      files: files.adrFiles,
      pattern: /^ADR-(\d{4})-.*\.md$/,
      prefix: "ADR",
      width: 4,
      displayDir: ADR_DIR,
    }),
  ];

  return filterIssuesForChangedFile(issues, changedFilePath);
}

function collectArchitectureFilenameIssues(files: ValidationFiles, changedFilePath?: string): ValidationIssue[] {
  const issues = collectFilenameIssues(files.planDir, PLAN_DIR, PLAN_FILENAME_PATTERN, "plan-*.md");
  return filterIssuesForChangedFile(issues, changedFilePath);
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
    ...collectFilenameIssues(files.planDir, PLAN_DIR, PLAN_FILENAME_PATTERN, "plan-*.md"),
    ...collectDuplicateValidationIssues(files),
    ...collectNumberingGapIssues(files.prdFiles, /^PRD-(\d{3})-.*\.md$/, "PRD", 3),
    ...collectNumberingGapIssues(files.adrFiles, /^ADR-(\d{4})-.*\.md$/, "ADR", 4),
  ];
  const result = formatValidationIssues(issues);
  ctx.ui.notify(result.message, result.level);
}

function resolveCommandPath(cwd: string, path: string): string {
  return path.startsWith("/") ? path : resolve(cwd, path);
}

function isSupportedSpecPath(path: string): boolean {
  return isPrd(path) || isAdr(path) || isPlan(path);
}

function normalizeBodyLines(lines: string[]): string[] {
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/[\t ]+$/g, "");
    const trimmed = line.trim();

    if (trimmed.startsWith("## ")) {
      while (result.length > 0 && result[result.length - 1] === "") {
        result.pop();
      }
      if (result.length > 0) {
        result.push("");
      }
      result.push(trimmed);
      while (i + 1 < lines.length && lines[i + 1].trim() === "") {
        i++;
      }
      result.push("");
      continue;
    }

    result.push(line);
  }

  while (result.length > 0 && result[result.length - 1] === "") {
    result.pop();
  }

  return result;
}

async function formatSpecDocument(content: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkGfm)
    .use(remarkStringify, {
      fences: true,
      listItemIndent: "one",
    })
    .process(content);

  const formatted = String(file);
  const lines = formatted.split("\n");
  if (!lines.length || lines[0].trim() !== "---") {
    return formatted;
  }

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) {
    return formatted;
  }

  const frontmatterLines = lines.slice(0, closingIndex + 1).map((line, index) => {
    if (index === 0 || index === closingIndex) {
      return "---";
    }
    return line.replace(/[\t ]+$/g, "");
  });
  const bodyLines = normalizeBodyLines(lines.slice(closingIndex + 1).filter((line, index, arr) => !(index === 0 && line.trim() === "" && arr.length > 0)));
  return `${frontmatterLines.join("\n")}\n\n${bodyLines.join("\n")}\n`;
}

export async function runFormat(
  args: unknown,
  ctx: { cwd: string } & ExtensionContext,
): Promise<void> {
  const params = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const rawPath = typeof params.path === "string" ? params.path : typeof params.file_path === "string" ? params.file_path : "";
  if (!rawPath) {
    ctx.ui.notify("[specdocs] specdocs-format requires a single path argument.", "error");
    return;
  }

  const targetPath = resolveCommandPath(ctx.cwd, rawPath);
  if (!existsSync(targetPath)) {
    ctx.ui.notify(`[specdocs] Format target does not exist: ${rawPath}`, "error");
    return;
  }

  if (!isSupportedSpecPath(targetPath)) {
    ctx.ui.notify(`[specdocs] Format target is an unsupported spec document path: ${rawPath}`, "error");
    return;
  }

  const parseResult = parseFrontmatterResult(targetPath);
  if (parseResult.error) {
    ctx.ui.notify(`[specdocs] Cannot format document with malformed frontmatter: ${parseResult.error}`, "error");
    return;
  }

  if (parseResult.fields === null) {
    ctx.ui.notify("[specdocs] Cannot format a spec document without YAML frontmatter.", "error");
    return;
  }

  const original = readFileSync(targetPath, "utf-8");
  const formatted = await formatSpecDocument(original);
  if (formatted === original) {
    ctx.ui.notify("[specdocs] No formatting changes were needed.", "info");
    return;
  }

  writeFileSync(targetPath, formatted);
  ctx.ui.notify(`[specdocs] Formatted spec document: ${rawPath}`, "info");
}
