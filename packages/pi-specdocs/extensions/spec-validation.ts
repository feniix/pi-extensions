import { basename } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";

const PRD_REQUIRED_FIELDS = ["title", "prd", "status", "owner", "date", "issue", "version"] as const;
const ADR_REQUIRED_FIELDS = ["title", "adr", "status", "date", "prd"] as const;

const PRD_VALID_STATUSES = ["Draft", "Implemented", "Superseded", "Archived"] as const;
const ADR_VALID_STATUSES = ["Proposed", "Accepted", "Deprecated", "Superseded"] as const;

export const PRD_FILENAME_PATTERN = /^PRD-\d{3}-.*\.md$/;
export const ADR_FILENAME_PATTERN = /^ADR-\d{4}-.*\.md$/;

export function isPrd(path: string): boolean {
  return path.includes("docs/prd/PRD-");
}

export function isAdr(path: string): boolean {
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

export function validateFrontmatter(filepath: string): string[] {
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
