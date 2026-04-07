/**
 * Notion utility functions for pi
 *
 * Shared formatting and config utilities used by other extensions and tests.
 * All Notion tools are provided by the MCP client (mcp-client.ts).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

interface NotionConfig {
	token?: string;
}

function resolveConfigPath(configPath: string): string {
	const trimmed = configPath.trim();
	if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
	if (trimmed.startsWith("~")) return join(homedir(), trimmed.slice(1));
	return resolve(process.cwd(), trimmed);
}

function loadConfig(configPath?: string): NotionConfig | null {
	const candidates: string[] = [];
	if (configPath) candidates.push(resolveConfigPath(configPath));
	else if (process.env.NOTION_CONFIG) candidates.push(resolveConfigPath(process.env.NOTION_CONFIG));
	else {
		const projectConfigPath = join(process.cwd(), ".pi", "extensions", "notion.json");
		const globalConfigPath = join(homedir(), ".pi", "agent", "extensions", "notion.json");
		if (!existsSync(globalConfigPath)) {
			try {
				mkdirSync(dirname(globalConfigPath), { recursive: true });
				writeFileSync(globalConfigPath, `${JSON.stringify({ token: null }, null, 2)}\n`, "utf-8");
			} catch {}
		}
		candidates.push(projectConfigPath, globalConfigPath);
	}
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			try {
				return JSON.parse(readFileSync(candidate, "utf-8"));
			} catch {}
		}
	}
	return null;
}

interface TitleProp {
	type?: string;
	title?: Array<{ plain_text: string }>;
}

function getTitleFromProperties(properties: Record<string, unknown>): string {
	const titleProp = Object.values(properties).find((p: unknown) => (p as TitleProp)?.type === "title") as
		| TitleProp
		| undefined;
	if (titleProp?.title) {
		return titleProp.title.map((t) => t.plain_text).join("") || "Untitled";
	}
	return "Untitled";
}

function formatPage(page: { id: string; url: string; properties: Record<string, unknown> }) {
	const title = getTitleFromProperties(page.properties);
	return `# Page: ${page.id}\nURL: ${page.url}\nTitle: ${title}\n\n## Properties\n${JSON.stringify(page.properties, null, 2)}`;
}

function formatDatabase(database: {
	id: string;
	title?: Array<{ plain_text: string }>;
	properties: Record<string, unknown>;
}) {
	const title = database.title?.map((t) => t.plain_text).join("") || "Untitled";
	return `# Database: ${database.id}\nTitle: ${title}\n\n## Properties\n${JSON.stringify(database.properties, null, 2)}`;
}

function formatBlocks(result: { results: Array<{ type: string; [key: string]: unknown }> }) {
	if (!result.results?.length) return "No blocks found.";
	return result.results
		.map((block) => {
			const type = block.type || "unknown";
			const content = (block[type] as Record<string, unknown>) || {};
			const text = (content.text as Array<{ plain_text: string }>)?.map((t) => t.plain_text).join("") || "";
			return `[${type}] ${text}`;
		})
		.join("\n");
}

function formatSearch(result: { results: unknown[] }) {
	if (!result.results?.length) return "No results found.";
	return result.results
		.map((item: unknown) => {
			const obj = item as { object: string; id: string; properties?: Record<string, unknown> };
			const type = obj.object;
			const title = obj.properties ? getTitleFromProperties(obj.properties) : "Untitled";
			return `- [${type}] ${title} (${obj.id})`;
		})
		.join("\n");
}

export {
	formatBlocks,
	formatDatabase,
	formatPage,
	formatSearch,
	getTitleFromProperties,
	loadConfig,
	resolveConfigPath,
};

// No-op extension — all tools are registered by mcp-client.ts
export default function notionExtension(_pi: ExtensionAPI) {}
