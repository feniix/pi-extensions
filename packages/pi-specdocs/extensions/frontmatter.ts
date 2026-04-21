import { existsSync, readFileSync } from "node:fs";

export function parseFrontmatter(filepath: string): Record<string, string> | null {
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

export function extractFrontmatterField(filepath: string, field: string): string {
  const fields = parseFrontmatter(filepath);
  return fields?.[field] ?? "";
}
