import { existsSync, readFileSync } from "node:fs";
import YAML from "yaml";

export interface FrontmatterParseResult {
  fields: Record<string, string> | null;
  rawFields: Record<string, unknown> | null;
  error: string | null;
  content: string | null;
  body: string;
}

function readDocument(filepath: string): string | null {
  if (!existsSync(filepath)) return null;

  try {
    return readFileSync(filepath, "utf-8");
  } catch {
    return null;
  }
}

export function parseFrontmatterResult(filepath: string): FrontmatterParseResult {
  const content = readDocument(filepath);
  if (content === null) {
    return { fields: null, rawFields: null, error: null, content: null, body: "" };
  }

  const lines = content.split("\n");
  if (!lines.length || lines[0].trim() !== "---") {
    return { fields: null, rawFields: null, error: null, content, body: content };
  }

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) {
    return { fields: null, rawFields: null, error: "Unterminated YAML frontmatter.", content, body: "" };
  }

  const yamlText = lines.slice(1, closingIndex).join("\n");
  const body = lines.slice(closingIndex + 1).join("\n");

  try {
    const parsed = YAML.parse(yamlText, { schema: "core" });
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { fields: {}, rawFields: {}, error: null, content, body };
    }

    const rawFields = parsed as Record<string, unknown>;
    const fields = Object.fromEntries(
      Object.entries(rawFields).map(([key, value]) => [key, value == null ? "" : String(value)]),
    );
    return { fields, rawFields, error: null, content, body };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { fields: null, rawFields: null, error: message, content, body };
  }
}

export function parseFrontmatter(filepath: string): Record<string, string> | null {
  const result = parseFrontmatterResult(filepath);
  return result.error ? null : result.fields;
}

export function extractFrontmatterField(filepath: string, field: string): string {
  const fields = parseFrontmatter(filepath);
  return fields?.[field] ?? "";
}
