import { basename } from "node:path";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { parseFrontmatterResult } from "./frontmatter.js";

const PRD_REQUIRED_FIELDS = ["title", "prd", "status", "owner", "date", "issue", "version"] as const;
const ADR_REQUIRED_FIELDS = ["title", "adr", "status", "date", "prd"] as const;
const PLAN_REQUIRED_FIELDS = ["title", "prd", "date", "author", "status"] as const;

const PRD_VALID_STATUSES = ["Draft", "Implemented", "Superseded", "Archived"] as const;
const ADR_VALID_STATUSES = ["Proposed", "Accepted", "Deprecated", "Superseded"] as const;
const PLAN_VALID_STATUSES = ["Draft", "Implemented", "Archived"] as const;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PLAN_PRD_PATTERN = /^PRD-\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

const PRD_REQUIRED_SECTIONS = [
  "## 1. Problem & Context",
  "## 2. Goals & Success Metrics",
  "## 3. Users & Use Cases",
  "## 4. Scope",
  "## 5. Functional Requirements",
  "## 6. Non-Functional Requirements",
  "## 7. Risks & Assumptions",
  "## 8. Design Decisions",
  "## 9. File Breakdown",
  "## 10. Dependencies & Constraints",
  "## 11. Rollout Plan",
  "## 12. Open Questions",
  "## 13. Related",
  "## 14. Changelog",
] as const;
const ADR_REQUIRED_SECTIONS = [
  "## Status",
  "## Date",
  "## Requirement Source",
  "## Context",
  "## Decision Drivers",
  "## Considered Options",
  "## Decision",
  "## Consequences",
  "## Related",
] as const;
const PLAN_REQUIRED_SECTIONS = [
  "## Source",
  "## Architecture Overview",
  "## Components",
  "## Implementation Order",
  "## ADR Index",
] as const;

const REQUIRED_TABLE_COLUMNS: Record<string, Record<string, readonly string[]>> = {
  PRD: {
    "Open Questions": ["#", "Question", "Owner", "Due", "Status"],
    "File Breakdown": ["File", "Change type", "FR", "Description"],
    Changelog: ["Date", "Change", "Author"],
  },
  PLAN: {
    "Implementation Order": ["Phase", "Component", "Dependencies", "Estimated Scope"],
    "ADR Index": ["ADR", "Title", "Status"],
  },
};

export const PRD_FILENAME_PATTERN = /^PRD-\d{3}-.*\.md$/;
export const ADR_FILENAME_PATTERN = /^ADR-\d{4}-.*\.md$/;
export const PLAN_FILENAME_PATTERN = /^plan-.*\.md$/;

export function isPrd(path: string): boolean {
  return path.includes("docs/prd/PRD-");
}

export function isAdr(path: string): boolean {
  return path.includes("docs/adr/ADR-");
}

export function isPlan(path: string): boolean {
  return path.includes("docs/architecture/plan-");
}

interface DocValidationConfig {
  docType: "PRD" | "ADR" | "PLAN";
  requiredFields: readonly string[];
  validStatuses: readonly string[];
  numberPattern?: RegExp;
  numberField?: "prd" | "adr";
  expectedNumberFormat?: string;
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

  if (isPlan(filepath)) {
    return {
      docType: "PLAN",
      requiredFields: PLAN_REQUIRED_FIELDS,
      validStatuses: PLAN_VALID_STATUSES,
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
  if (!config.numberField || !config.numberPattern || !config.expectedNumberFormat) {
    return;
  }

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

function collectPlanWarnings(fields: Record<string, string>, warnings: string[]): void {
  const date = fields.date ?? "";
  if (date && !ISO_DATE_PATTERN.test(date)) {
    warnings.push("⚠ PLAN: date must use ISO format YYYY-MM-DD.");
  }

  const prd = fields.prd ?? "";
  if (prd && !PLAN_PRD_PATTERN.test(prd)) {
    warnings.push("⚠ PLAN: prd must use the format PRD-NNN-descriptive-slug.");
  }
}

function validateFrontmatterFromResult(
  filepath: string,
  result: ReturnType<typeof parseFrontmatterResult>,
): string[] {
  const config = getDocValidationConfig(filepath);
  if (!config) {
    return [];
  }

  if (result.error) {
    return [`⚠ ${config.docType}: Frontmatter parse error: ${result.error}`];
  }

  const fields = result.fields;
  if (fields === null) {
    return [`⚠ ${config.docType}: No YAML frontmatter found.`];
  }

  const warnings: string[] = [];
  collectMissingFieldWarnings(fields, config, warnings);
  collectNumberWarnings(fields, config, basename(filepath), warnings);
  collectStatusWarnings(fields, config, warnings);
  if (config.docType === "PLAN") {
    collectPlanWarnings(fields, warnings);
  }
  return warnings;
}

export function validateFrontmatter(filepath: string): string[] {
  return validateFrontmatterFromResult(filepath, parseFrontmatterResult(filepath));
}

function getRequiredSections(filepath: string): readonly string[] {
  if (isPrd(filepath)) return PRD_REQUIRED_SECTIONS;
  if (isAdr(filepath)) return ADR_REQUIRED_SECTIONS;
  if (isPlan(filepath)) return PLAN_REQUIRED_SECTIONS;
  return [];
}

function getDocTypeLabel(filepath: string): "PRD" | "ADR" | "PLAN" | null {
  if (isPrd(filepath)) return "PRD";
  if (isAdr(filepath)) return "ADR";
  if (isPlan(filepath)) return "PLAN";
  return null;
}

function normalizeHeadingText(heading: string): string {
  return heading.replace(/^\d+\.\s+/, "").trim();
}

type MdNode = {
  type?: string;
  depth?: number;
  value?: string;
  children?: MdNode[];
};

function extractNodeText(node: MdNode | undefined): string {
  if (!node) return "";
  if (typeof node.value === "string") return node.value;
  if (!Array.isArray(node.children)) return "";
  return node.children.map((child) => extractNodeText(child)).join("");
}

function parseMarkdownTree(body: string): MdNode {
  return unified().use(remarkParse).use(remarkFrontmatter, ["yaml"]).use(remarkGfm).parse(body) as MdNode;
}

interface ParsedSpecDocument {
  filepath: string;
  label: "PRD" | "ADR" | "PLAN" | null;
  frontmatter: ReturnType<typeof parseFrontmatterResult>;
  headings: Set<string>;
  tables: Map<string, string[][]>;
}

function parseSpecDocument(filepath: string): ParsedSpecDocument {
  const frontmatter = parseFrontmatterResult(filepath);
  const body = frontmatter.content === null ? "" : frontmatter.body;
  const tree = parseMarkdownTree(body);
  const children = Array.isArray(tree.children) ? tree.children : [];
  const headings = new Set<string>();
  const tables = new Map<string, string[][]>();
  let currentSection = "";

  for (const node of children) {
    if (node.type === "heading" && node.depth === 2) {
      const headingText = extractNodeText(node).trim();
      headings.add(`## ${headingText}`);
      currentSection = normalizeHeadingText(headingText);
      continue;
    }

    if (!currentSection || node.type !== "table" || !Array.isArray(node.children) || node.children.length === 0) {
      continue;
    }

    const headerRow = node.children[0];
    const headerCells = Array.isArray(headerRow?.children) ? headerRow.children : [];
    const sectionTables = tables.get(currentSection) ?? [];
    sectionTables.push(headerCells.map((cell) => extractNodeText(cell).trim()));
    tables.set(currentSection, sectionTables);
  }

  return {
    filepath,
    label: getDocTypeLabel(filepath),
    frontmatter,
    headings,
    tables,
  };
}

function validateRequiredSectionsFromDocument(document: ParsedSpecDocument): string[] {
  const requiredSections = getRequiredSections(document.filepath);
  if (requiredSections.length === 0) {
    return [];
  }

  const label = document.label ?? "PRD";
  return requiredSections
    .filter((section) => !document.headings.has(section))
    .map((section) => `⚠ ${label}: Missing required section: ${section}`);
}

function validateRequiredTablesFromDocument(document: ParsedSpecDocument): string[] {
  const label = document.label;
  if (!label || !(label in REQUIRED_TABLE_COLUMNS)) {
    return [];
  }

  const warnings: string[] = [];
  for (const [section, requiredColumns] of Object.entries(REQUIRED_TABLE_COLUMNS[label])) {
    const sectionTables = document.tables.get(section);
    if (!sectionTables || sectionTables.length === 0) {
      warnings.push(`⚠ ${label}: Missing required table in section ${section}.`);
      continue;
    }

    const matchingTable = sectionTables.find((headers) => requiredColumns.every((column) => headers.includes(column)));
    if (!matchingTable) {
      const combinedHeaders = Array.from(new Set(sectionTables.flat()));
      const missingColumns = requiredColumns.filter((column) => !combinedHeaders.includes(column));
      warnings.push(`⚠ ${label}: Table ${section} is missing required columns: ${missingColumns.join(", ")}.`);
    }
  }

  return warnings;
}

export function validateRequiredSections(filepath: string): string[] {
  return validateRequiredSectionsFromDocument(parseSpecDocument(filepath));
}

export function validateRequiredTables(filepath: string): string[] {
  return validateRequiredTablesFromDocument(parseSpecDocument(filepath));
}

export function validateSpecFile(filepath: string): string[] {
  const document = parseSpecDocument(filepath);
  return [
    ...validateFrontmatterFromResult(filepath, document.frontmatter),
    ...validateRequiredSectionsFromDocument(document),
    ...validateRequiredTablesFromDocument(document),
  ];
}
