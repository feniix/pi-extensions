import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { parseFrontmatterResult } from "./frontmatter.js";
import {
  ADR_FILENAME_PATTERN,
  isAdr,
  isPlan,
  isPrd,
  PLAN_FILENAME_PATTERN,
  PRD_FILENAME_PATTERN,
  validateSpecFile,
} from "./spec-validation.js";
import { ADR_DIR, listMatchingFiles, PLAN_DIR, PRD_DIR } from "./workspace-scan.js";

const formatProcessor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkGfm)
  .use(remarkStringify, {
    fences: true,
    listItemIndent: "one",
  });

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
  if (
    !filePath ||
    (!isPrd(filePath) && !isAdr(filePath) && !isPlan(filePath) && !isArchitectureMarkdown(filePath)) ||
    !existsSync(filePath)
  ) {
    return;
  }

  const warnings = validateSpecFile(filePath);
  const validationFiles = typeof ctx.cwd === "string" ? getValidationFiles(ctx.cwd) : null;
  const duplicateIssues = validationFiles ? collectDuplicateValidationIssues(validationFiles, filePath, ctx.cwd) : [];
  const architectureFilenameIssues = validationFiles
    ? collectArchitectureFilenameIssues(validationFiles, filePath, ctx.cwd)
    : [];
  const messages = [
    ...warnings,
    ...duplicateIssues.map((issue) => issue.message),
    ...architectureFilenameIssues.map((issue) => issue.message),
  ];

  if (messages.length > 0) {
    ctx.ui.notify(`[specdocs] Validation warnings:\n${messages.join("\n")}`, "warning");
  }
}

interface ValidationIssue {
  type: "error" | "warning";
  message: string;
  filePath?: string;
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

function toWarningIssues(messages: string[], filePath?: string): ValidationIssue[] {
  return messages.map((message) => ({ type: "warning", message, filePath }));
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
  const groups = [
    { files: files.prdFiles, absoluteDir: files.prdDir, displayDir: PRD_DIR },
    { files: files.adrFiles, absoluteDir: files.adrDir, displayDir: ADR_DIR },
    { files: files.planFiles, absoluteDir: files.planDir, displayDir: PLAN_DIR },
  ];

  for (const group of groups) {
    for (const filename of group.files) {
      const filepath = join(group.absoluteDir, filename);
      issues.push(...toWarningIssues(validateSpecFile(filepath), `${group.displayDir}/${filename}`));
    }
  }

  return issues;
}

function toRepoRelativePath(cwd: string, path: string): string {
  const relativePath = relative(cwd, path).replace(/\\/g, "/");
  return relativePath.startsWith("../") ? path : relativePath;
}

function filterIssuesForChangedFile(
  issues: ValidationIssue[],
  changedFilePath?: string,
  cwd?: string,
): ValidationIssue[] {
  if (!changedFilePath) {
    return issues;
  }

  const changedPath = cwd ? toRepoRelativePath(cwd, changedFilePath) : changedFilePath.replace(/\\/g, "/");
  return issues.filter((issue) => issue.message.includes(changedPath) || issue.filePath === changedPath);
}

function collectDuplicateValidationIssues(
  files: ValidationFiles,
  changedFilePath?: string,
  cwd?: string,
): ValidationIssue[] {
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

  return filterIssuesForChangedFile(issues, changedFilePath, cwd);
}

function collectArchitectureFilenameIssues(
  files: ValidationFiles,
  changedFilePath?: string,
  cwd?: string,
): ValidationIssue[] {
  const issues = collectFilenameIssues(files.planDir, PLAN_DIR, PLAN_FILENAME_PATTERN, "plan-*.md");
  return filterIssuesForChangedFile(issues, changedFilePath, cwd);
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
      filePath: `${displayDir}/${filename}`,
      message: `✗ filename doesn't match ${expected} pattern`,
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

function formatIssueGroup(title: string, issues: ValidationIssue[]): string[] {
  const lines: string[] = [title];
  const grouped = new Map<string, ValidationIssue[]>();
  const globalIssues: ValidationIssue[] = [];

  for (const issue of issues) {
    if (!issue.filePath) {
      globalIssues.push(issue);
      continue;
    }

    const existing = grouped.get(issue.filePath) ?? [];
    existing.push(issue);
    grouped.set(issue.filePath, existing);
  }

  for (const filePath of Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b))) {
    lines.push(`  ${filePath}`);
    for (const issue of grouped.get(filePath) ?? []) {
      lines.push(`    ${issue.message}`);
    }
  }

  if (globalIssues.length > 0) {
    lines.push("  Workspace");
    for (const issue of globalIssues) {
      lines.push(`    ${issue.message}`);
    }
  }

  return lines;
}

function formatValidationIssues(issues: ValidationIssue[]): { message: string; level: "error" | "warning" | "info" } {
  if (issues.length === 0) {
    return { message: "[specdocs] Validation passed: no issues found.", level: "info" };
  }

  const errors = issues.filter((issue) => issue.type === "error");
  const warnings = issues.filter((issue) => issue.type === "warning");
  const lines: string[] = [];

  if (errors.length > 0) {
    lines.push(...formatIssueGroup(`Errors (${errors.length}):`, errors));
  }

  if (warnings.length > 0) {
    lines.push(...formatIssueGroup(`Warnings (${warnings.length}):`, warnings));
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

function extractCommandPathArg(args: unknown): string {
  if (typeof args === "string") {
    return args.trim();
  }

  if (!args || typeof args !== "object") {
    return "";
  }

  const params = args as Record<string, unknown>;
  if (typeof params.path === "string") {
    return params.path.trim();
  }

  if (typeof params.file_path === "string") {
    return params.file_path.trim();
  }

  return "";
}

function isSupportedSpecPath(path: string): boolean {
  return isPrd(path) || isAdr(path) || isPlan(path);
}

function isThematicBreak(line: string): boolean {
  // Accept common CommonMark thematic-break spellings; formatting canonicalizes them to `---`.
  return /^(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line.trim());
}

function normalizeBodyLines(lines: string[]): string[] {
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/[\t ]+$/g, "");
    const trimmed = line.trim();

    if (trimmed.startsWith("## ") || isThematicBreak(trimmed)) {
      while (result.length > 0 && result[result.length - 1] === "") {
        result.pop();
      }
      if (result.length > 0) {
        result.push("");
      }
      result.push(isThematicBreak(trimmed) ? "---" : trimmed);
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
  const file = await formatProcessor.process(content);

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
  const bodyLines = normalizeBodyLines(
    lines.slice(closingIndex + 1).filter((line, index, arr) => !(index === 0 && line.trim() === "" && arr.length > 0)),
  );
  return `${frontmatterLines.join("\n")}\n\n${bodyLines.join("\n")}\n`;
}

export async function runFormat(args: unknown, ctx: { cwd: string } & ExtensionContext): Promise<void> {
  const rawPath = extractCommandPathArg(args);
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

  const original = parseResult.content ?? readFileSync(targetPath, "utf-8");
  const formatted = await formatSpecDocument(original);
  if (formatted === original) {
    ctx.ui.notify("[specdocs] No formatting changes were needed.", "info");
    return;
  }

  writeFileSync(targetPath, formatted);
  ctx.ui.notify(`[specdocs] Formatted spec document: ${rawPath}`, "info");
}
