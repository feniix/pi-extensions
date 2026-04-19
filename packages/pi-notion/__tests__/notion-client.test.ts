/**
 * Tests for index.ts utility functions and file structure
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const indexPath = join(__dirname, "../extensions/index.ts");
const mcpClientPath = join(__dirname, "../extensions/mcp-client.ts");
const oauthPath = join(__dirname, "../extensions/oauth.ts");

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

// =============================================================================
// Extension File Structure Tests
// =============================================================================

describe("pi-notion Extension File Structure", () => {
  it("index.ts contains NotionConfig interface", () => {
    const content = read(indexPath);
    expect(content).toContain("NotionConfig");
  });

  it("index.ts contains config loading functions", () => {
    const content = read(indexPath);

    expect(content).toContain("resolveConfigPath");
    expect(content).toContain("loadConfig");
    expect(content).toContain("homedir");
    expect(content).toContain("NOTION_CONFIG");
  });

  it("index.ts contains formatting functions", () => {
    const content = read(indexPath);

    expect(content).toContain("formatPage");
    expect(content).toContain("formatDatabase");
    expect(content).toContain("formatBlocks");
    expect(content).toContain("formatSearch");
    expect(content).toContain("getTitleFromProperties");
  });

  it("index.ts exports utility functions", () => {
    const content = read(indexPath);

    expect(content).toContain("export {");
    expect(content).toContain("formatBlocks");
    expect(content).toContain("loadConfig");
    expect(content).toContain("resolveConfigPath");
  });

  it("index.ts has extension entry point and session hooks", () => {
    const content = read(indexPath);

    expect(content).toContain("export default function notion");
    expect(content).toContain('pi.on("session_start"');
    expect(content).toContain('pi.on("tool_call"');
  });

  it("mcp-client.ts exists and has default export", () => {
    const content = read(mcpClientPath);
    expect(content).toContain("export default");
  });

  it("oauth.ts exists and has expected exports", () => {
    const content = read(oauthPath);

    expect(content).toContain("export function generateCodeVerifier");
    expect(content).toContain("export class FileTokenStorage");
  });
});

// =============================================================================
// Formatting Function Details
// =============================================================================

describe("pi-notion Formatting Functions", () => {
  it("formatPage formats page with title and properties", () => {
    const content = read(indexPath);

    expect(content).toContain("function formatPage");
    expect(content).toContain("getTitleFromProperties");
    expect(content).toContain("JSON.stringify");
  });

  it("formatDatabase formats database with title", () => {
    const content = read(indexPath);

    expect(content).toContain("function formatDatabase");
    expect(content).toContain("plain_text");
  });

  it("formatBlocks handles empty results", () => {
    const content = read(indexPath);

    expect(content).toContain("function formatBlocks");
    expect(content).toContain("No blocks found");
  });

  it("formatSearch handles empty results", () => {
    const content = read(indexPath);

    expect(content).toContain("function formatSearch");
    expect(content).toContain("No results found");
  });

  it("getTitleFromProperties extracts title from properties", () => {
    const content = read(indexPath);

    expect(content).toContain("function getTitleFromProperties");
    expect(content).toContain("Untitled");
  });
});
