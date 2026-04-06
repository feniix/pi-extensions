/**
 * Notion API Extension for pi
 *
 * Supports two authentication methods:
 * 1. Integration Token (Internal): Set NOTION_TOKEN or use --notion-token flag
 * 2. OAuth (Public Integration): Configure in notion.json for user-based auth
 */

import { exec as execCallback } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import axios, { type AxiosInstance } from "axios";
import { executeOAuthFlow, FileTokenStorage, getValidAccessToken, type OAuthConfig } from "./oauth.js";

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";

interface NotionConfig {
	token?: string;
	oauth?: OAuthConfig;
}

interface NotionToolDetails {
	tool: string;
}

class NotionClient {
	private client: AxiosInstance;

	constructor(token: string) {
		this.client = axios.create({
			baseURL: NOTION_API_BASE,
			headers: {
				Authorization: `Bearer ${token}`,
				"Notion-Version": NOTION_VERSION,
				"Content-Type": "application/json",
			},
		});
	}

	async getPage(pageId: string) {
		const response = await this.client.get(`/pages/${pageId}`);
		return response.data;
	}

	async createPage(
		parentId: string,
		parentType: "page_id" | "database_id",
		properties: Record<string, unknown>,
		children?: unknown[],
	) {
		const body: Record<string, unknown> = {
			parent: { [parentType]: parentId },
			properties,
		};
		if (children) body.children = children;
		const response = await this.client.post("/pages", body);
		return response.data;
	}

	async updatePage(pageId: string, properties: Record<string, unknown>, archived?: boolean) {
		const body: Record<string, unknown> = { properties };
		if (archived !== undefined) body.archived = archived;
		const response = await this.client.patch(`/pages/${pageId}`, body);
		return response.data;
	}

	async getDatabase(databaseId: string) {
		const response = await this.client.get(`/databases/${databaseId}`);
		return response.data;
	}

	async queryDatabase(databaseId: string, filter?: unknown, sorts?: unknown, startCursor?: string, pageSize?: number) {
		const body: Record<string, unknown> = {};
		if (filter) body.filter = filter;
		if (sorts) body.sorts = sorts;
		if (startCursor) body.start_cursor = startCursor;
		if (pageSize) body.page_size = pageSize;
		const response = await this.client.post(`/databases/${databaseId}/query`, body);
		return response.data;
	}

	async createDatabase(parentPageId: string, title: string, properties: Record<string, unknown>) {
		const response = await this.client.post("/databases", {
			parent: { page_id: parentPageId },
			title: [{ type: "text", text: { content: title } }],
			properties,
		});
		return response.data;
	}

	async getBlockChildren(blockId: string, startCursor?: string) {
		const params: Record<string, string> = {};
		if (startCursor) params.start_cursor = startCursor;
		const response = await this.client.get(`/blocks/${blockId}/children`, { params });
		return response.data;
	}

	async appendBlockChildren(blockId: string, children: unknown[]) {
		const response = await this.client.patch(`/blocks/${blockId}/children`, { children });
		return response.data;
	}

	async search(query: string, filter?: { value: string; property: string }, startCursor?: string) {
		const body: Record<string, unknown> = { query };
		if (filter) body.filter = filter;
		if (startCursor) body.start_cursor = startCursor;
		const response = await this.client.post("/search", body);
		return response.data;
	}

	async getUser(userId: string) {
		const response = await this.client.get(`/users/${userId}`);
		return response.data;
	}

	async getMe() {
		const response = await this.client.get("/users/me");
		return response.data;
	}
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
				writeFileSync(globalConfigPath, `${JSON.stringify({ token: null, oauth: null }, null, 2)}\n`, "utf-8");
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

export default function notionExtension(pi: ExtensionAPI) {
	pi.registerFlag("--notion-token", { description: "Notion integration token", type: "string" });
	pi.registerFlag("--notion-config", { description: "Path to JSON config file", type: "string" });

	const getToken = (): string => {
		const tokenFlag = pi.getFlag("--notion-token");
		if (typeof tokenFlag === "string" && tokenFlag) return tokenFlag.trim();
		const configFlag = pi.getFlag("--notion-config");
		const config = loadConfig(typeof configFlag === "string" ? configFlag : undefined);
		if (config?.token) return config.token;
		const envToken = process.env.NOTION_TOKEN;
		if (envToken) return envToken.trim();
		return "";
	};

	const getOAuthConfig = (): OAuthConfig | null => {
		const configFlag = pi.getFlag("--notion-config");
		const config = loadConfig(typeof configFlag === "string" ? configFlag : undefined);
		if (config?.oauth?.clientId && config?.oauth?.clientSecret && config?.oauth?.redirectUri) {
			return config.oauth;
		}
		return null;
	};

	const getConfigPath = (): string => {
		const configFlag = pi.getFlag("--notion-config");
		if (typeof configFlag === "string" && configFlag) {
			return resolveConfigPath(configFlag);
		}
		const projectConfigPath = join(process.cwd(), ".pi", "extensions", "notion.json");
		const globalConfigPath = join(homedir(), ".pi", "agent", "extensions", "notion.json");
		if (existsSync(projectConfigPath)) return projectConfigPath;
		return globalConfigPath;
	};

	const getClient = async (): Promise<NotionClient> => {
		const oauthConfig = getOAuthConfig();

		if (oauthConfig) {
			// Try OAuth first
			const configPath = getConfigPath();
			const storage = new FileTokenStorage(configPath);

			try {
				const accessToken = await getValidAccessToken(oauthConfig, storage);
				if (accessToken) {
					return new NotionClient(accessToken);
				}
			} catch {
				// OAuth failed, fall through to token auth
			}
		}

		// Fall back to token auth
		const token = getToken();
		if (!token) {
			throw new Error(
				"Notion token not configured. Set NOTION_TOKEN, use --notion-token flag, or configure OAuth in notion.json.\n" +
					"Run /notion-oauth-setup to configure OAuth authentication.",
			);
		}
		return new NotionClient(token);
	};

	const openBrowser = (url: string): void => {
		const platform = process.platform;
		const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
		execCallback(`${cmd} "${url}"`);
	};

	// OAuth Setup Tool
	pi.registerTool({
		name: "notion_oauth_setup",
		label: "Notion OAuth Setup",
		description:
			"Configure OAuth authentication for Notion. Requires a public Notion integration with client_id, client_secret, and redirect_uri configured in notion.json.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			try {
				const configFlag = pi.getFlag("--notion-config");
				const config = loadConfig(typeof configFlag === "string" ? configFlag : undefined);

				if (!config?.oauth?.clientId || !config?.oauth?.clientSecret || !config?.oauth?.redirectUri) {
					return {
						content: [
							{
								type: "text",
								text: `OAuth not configured. Please add oauth configuration to your notion.json:

{
  "oauth": {
    "clientId": "your-client-id",
    "clientSecret": "your-client-secret",
    "redirectUri": "http://localhost:3000/callback"
  }
}

To create a public Notion integration:
1. Go to https://www.notion.so/profile/integrations
2. Click "New integration" and select "Public"
3. Configure OAuth settings with redirect URI: http://localhost:3000/callback
4. Copy the Client ID and Client Secret`,
							},
						],
						isError: true,
						details: { tool: "notion_oauth_setup", error: "oauth_not_configured" },
					};
				}

				const configPath = getConfigPath();
				const storage = new FileTokenStorage(configPath);
				const result = await executeOAuthFlow(config.oauth, storage, openBrowser, (msg, _type) => {
					ctx.ui.notify(msg, "info");
				});

				return {
					content: [
						{
							type: "text",
							text: `OAuth authorization successful!

Connected to workspace: ${result.userInfo.workspaceName}
Workspace ID: ${result.userInfo.workspaceId}
Owner: ${result.userInfo.ownerName || "Unknown"} (${result.userInfo.ownerEmail || "N/A"})

You can now use Notion tools without needing a manual token.`,
						},
					],
					details: { tool: "notion_oauth_setup", userInfo: result.userInfo },
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `OAuth setup failed: ${message}` }],
					isError: true,
					details: { tool: "notion_oauth_setup", error: message },
				};
			}
		},
	});

	// OAuth Status Tool
	pi.registerTool({
		name: "notion_oauth_status",
		label: "Notion OAuth Status",
		description: "Check the current OAuth authentication status",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			try {
				const configFlag = pi.getFlag("--notion-config");
				const config = loadConfig(typeof configFlag === "string" ? configFlag : undefined);
				const oauthConfigured = !!(
					config?.oauth?.clientId &&
					config?.oauth?.clientSecret &&
					config?.oauth?.redirectUri
				);

				if (!oauthConfigured) {
					return {
						content: [
							{
								type: "text",
								text: `OAuth Status: Not Configured

To enable OAuth authentication, add to your notion.json:

{
  "oauth": {
    "clientId": "your-client-id",
    "clientSecret": "your-client-secret",
    "redirectUri": "http://localhost:3000/callback"
  }
}`,
							},
						],
						details: { tool: "notion_oauth_status", configured: false },
					};
				}

				const configPath = getConfigPath();
				const storage = new FileTokenStorage(configPath);
				const tokens = await storage.load();
				const userInfo = await storage.getUserInfo();

				if (!tokens) {
					return {
						content: [
							{
								type: "text",
								text: `OAuth Status: Configured but not authorized

Run notion_oauth_setup to complete the authorization flow.`,
							},
						],
						details: { tool: "notion_oauth_status", configured: true, authorized: false },
					};
				}

				const isExpired = Date.now() > tokens.expiresAt;
				const tokenAge = Math.round((Date.now() - (tokens.expiresAt - 3600000)) / 1000 / 60);

				return {
					content: [
						{
							type: "text",
							text: `OAuth Status: Active

Workspace: ${userInfo?.workspaceName || "Unknown"}
Workspace ID: ${userInfo?.workspaceId || "Unknown"}
Owner: ${userInfo?.ownerName || "Unknown"} (${userInfo?.ownerEmail || "N/A"})
Token Age: ${tokenAge} minutes
Token Expired: ${isExpired ? "Yes" : "No"}

Use notion_oauth_setup to re-authorize if needed.`,
						},
					],
					details: {
						tool: "notion_oauth_status",
						configured: true,
						authorized: true,
						userInfo,
						isExpired,
					},
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `OAuth status check failed: ${message}` }],
					isError: true,
					details: { tool: "notion_oauth_status", error: message },
				};
			}
		},
	});

	// OAuth Logout Tool
	pi.registerTool({
		name: "notion_oauth_logout",
		label: "Notion OAuth Logout",
		description: "Clear OAuth tokens and log out from Notion",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			try {
				const configPath = getConfigPath();
				const storage = new FileTokenStorage(configPath);
				await storage.clear();

				return {
					content: [
						{
							type: "text",
							text: `OAuth tokens cleared. You have been logged out from Notion.

To use Notion again, either:
- Run notion_oauth_setup to re-authorize with OAuth
- Set NOTION_TOKEN environment variable with an integration token`,
						},
					],
					details: { tool: "notion_oauth_logout" },
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `OAuth logout failed: ${message}` }],
					isError: true,
					details: { tool: "notion_oauth_logout", error: message },
				};
			}
		},
	});

	pi.registerTool({
		name: "notion_get_page",
		label: "Notion Get Page",
		description: "Retrieve a page by its ID",
		parameters: Type.Object({ pageId: Type.String() }),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				const client = await getClient();
				const page = await client.getPage((params as { pageId: string }).pageId);
				return {
					content: [{ type: "text", text: formatPage(page) }],
					details: { tool: "notion_get_page" } satisfies NotionToolDetails,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Notion error: ${message}` }],
					isError: true,
					details: { tool: "notion_get_page", error: message } satisfies NotionToolDetails & { error: string },
				};
			}
		},
	});

	pi.registerTool({
		name: "notion_create_page",
		label: "Notion Create Page",
		description: "Create a new page",
		parameters: Type.Object({
			parentId: Type.String({ description: "Parent page ID or database ID" }),
			parentType: Type.Optional(Type.Union([Type.Literal("page_id"), Type.Literal("database_id")])),
			title: Type.String({ description: "Page title" }),
			properties: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
			content: Type.Optional(Type.Array(Type.Unknown())),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				const client = await getClient();
				const p = params as {
					parentId: string;
					parentType?: "page_id" | "database_id";
					title: string;
					properties?: Record<string, unknown>;
					content?: unknown[];
				};
				const properties: Record<string, unknown> = p.properties || {};
				properties.title = { title: [{ text: { content: p.title } }] };
				const page = await client.createPage(p.parentId, p.parentType || "page_id", properties, p.content);
				return {
					content: [{ type: "text", text: `Created page: ${page.id}\n${page.url}` }],
					details: { tool: "notion_create_page" } satisfies NotionToolDetails,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Notion error: ${message}` }],
					isError: true,
					details: { tool: "notion_create_page", error: message } satisfies NotionToolDetails & { error: string },
				};
			}
		},
	});

	pi.registerTool({
		name: "notion_update_page",
		label: "Notion Update Page",
		description: "Update a page's properties",
		parameters: Type.Object({
			pageId: Type.String(),
			title: Type.Optional(Type.String()),
			properties: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
			archived: Type.Optional(Type.Boolean()),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				const client = await getClient();
				const p = params as {
					pageId: string;
					title?: string;
					properties?: Record<string, unknown>;
					archived?: boolean;
				};
				const properties: Record<string, unknown> = p.properties || {};
				if (p.title) properties.title = { title: [{ text: { content: p.title } }] };
				const page = await client.updatePage(p.pageId, properties, p.archived);
				return {
					content: [{ type: "text", text: `Updated page: ${page.id}` }],
					details: { tool: "notion_update_page" } satisfies NotionToolDetails,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Notion error: ${message}` }],
					isError: true,
					details: { tool: "notion_update_page", error: message } satisfies NotionToolDetails & { error: string },
				};
			}
		},
	});

	pi.registerTool({
		name: "notion_archive_page",
		label: "Notion Archive Page",
		description: "Archive a page",
		parameters: Type.Object({ pageId: Type.String() }),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				const client = await getClient();
				const { pageId } = params as { pageId: string };
				await client.updatePage(pageId, {}, true);
				return {
					content: [{ type: "text", text: `Archived page: ${pageId}` }],
					details: { tool: "notion_archive_page" } satisfies NotionToolDetails,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Notion error: ${message}` }],
					isError: true,
					details: { tool: "notion_archive_page", error: message } satisfies NotionToolDetails & { error: string },
				};
			}
		},
	});

	pi.registerTool({
		name: "notion_get_database",
		label: "Notion Get Database",
		description: "Get database metadata",
		parameters: Type.Object({ databaseId: Type.String() }),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				const client = await getClient();
				const database = await client.getDatabase((params as { databaseId: string }).databaseId);
				return {
					content: [{ type: "text", text: formatDatabase(database) }],
					details: { tool: "notion_get_database" } satisfies NotionToolDetails,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Notion error: ${message}` }],
					isError: true,
					details: { tool: "notion_get_database", error: message } satisfies NotionToolDetails & { error: string },
				};
			}
		},
	});

	pi.registerTool({
		name: "notion_query_database",
		label: "Notion Query Database",
		description: "Query a database",
		parameters: Type.Object({
			databaseId: Type.String(),
			filter: Type.Optional(Type.Unknown()),
			sorts: Type.Optional(Type.Unknown()),
			startCursor: Type.Optional(Type.String()),
			pageSize: Type.Optional(Type.Integer()),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				const client = await getClient();
				const p = params as {
					databaseId: string;
					filter?: unknown;
					sorts?: unknown;
					startCursor?: string;
					pageSize?: number;
				};
				const result = await client.queryDatabase(p.databaseId, p.filter, p.sorts, p.startCursor, p.pageSize);
				return {
					content: [{ type: "text", text: formatSearch(result) }],
					details: { tool: "notion_query_database" } satisfies NotionToolDetails,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Notion error: ${message}` }],
					isError: true,
					details: { tool: "notion_query_database", error: message } satisfies NotionToolDetails & { error: string },
				};
			}
		},
	});

	pi.registerTool({
		name: "notion_create_database",
		label: "Notion Create Database",
		description: "Create a new database",
		parameters: Type.Object({
			parentPageId: Type.String(),
			title: Type.String(),
			properties: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				const client = await getClient();
				const p = params as { parentPageId: string; title: string; properties?: Record<string, unknown> };
				const database = await client.createDatabase(p.parentPageId, p.title, p.properties || { Name: { title: {} } });
				return {
					content: [{ type: "text", text: `Created database: ${database.id}` }],
					details: { tool: "notion_create_database" } satisfies NotionToolDetails,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Notion error: ${message}` }],
					isError: true,
					details: { tool: "notion_create_database", error: message } satisfies NotionToolDetails & { error: string },
				};
			}
		},
	});

	pi.registerTool({
		name: "notion_get_block_children",
		label: "Notion Get Block Children",
		description: "Get page or block children",
		parameters: Type.Object({ blockId: Type.String(), startCursor: Type.Optional(Type.String()) }),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				const client = await getClient();
				const p = params as { blockId: string; startCursor?: string };
				const result = await client.getBlockChildren(p.blockId, p.startCursor);
				return {
					content: [{ type: "text", text: formatBlocks(result) }],
					details: { tool: "notion_get_block_children" } satisfies NotionToolDetails,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Notion error: ${message}` }],
					isError: true,
					details: { tool: "notion_get_block_children", error: message } satisfies NotionToolDetails & {
						error: string;
					},
				};
			}
		},
	});

	pi.registerTool({
		name: "notion_append_blocks",
		label: "Notion Append Blocks",
		description: "Append blocks to a page",
		parameters: Type.Object({ blockId: Type.String(), blocks: Type.Array(Type.Unknown()) }),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				const client = await getClient();
				const p = params as { blockId: string; blocks: unknown[] };
				const result = await client.appendBlockChildren(p.blockId, p.blocks);
				return {
					content: [{ type: "text", text: `Appended ${result.results.length} blocks` }],
					details: { tool: "notion_append_blocks" } satisfies NotionToolDetails,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Notion error: ${message}` }],
					isError: true,
					details: { tool: "notion_append_blocks", error: message } satisfies NotionToolDetails & { error: string },
				};
			}
		},
	});

	pi.registerTool({
		name: "notion_search",
		label: "Notion Search",
		description: "Search pages and databases",
		parameters: Type.Object({
			query: Type.String(),
			type: Type.Optional(Type.Union([Type.Literal("page"), Type.Literal("database")])),
			startCursor: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				const client = await getClient();
				const p = params as { query: string; type?: "page" | "database"; startCursor?: string };
				const filter = p.type ? { value: p.type, property: "object" } : undefined;
				const result = await client.search(p.query, filter, p.startCursor);
				return {
					content: [{ type: "text", text: formatSearch(result) }],
					details: { tool: "notion_search" } satisfies NotionToolDetails,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Notion error: ${message}` }],
					isError: true,
					details: { tool: "notion_search", error: message } satisfies NotionToolDetails & { error: string },
				};
			}
		},
	});

	pi.registerTool({
		name: "notion_get_user",
		label: "Notion Get User",
		description: "Get user by ID",
		parameters: Type.Object({ userId: Type.String() }),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				const client = await getClient();
				const user = await client.getUser((params as { userId: string }).userId);
				const email = user.person?.email ? `\nEmail: ${user.person.email}` : "";
				return {
					content: [
						{ type: "text", text: `User: ${user.name || "Unknown"}\nType: ${user.type}\nID: ${user.id}${email}` },
					],
					details: { tool: "notion_get_user" } satisfies NotionToolDetails,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Notion error: ${message}` }],
					isError: true,
					details: { tool: "notion_get_user", error: message } satisfies NotionToolDetails & { error: string },
				};
			}
		},
	});

	pi.registerTool({
		name: "notion_get_me",
		label: "Notion Get Me",
		description: "Get current authenticated user",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			try {
				const client = await getClient();
				const user = await client.getMe();
				const email = user.person?.email ? `\nEmail: ${user.person.email}` : "";
				return {
					content: [
						{ type: "text", text: `User: ${user.name || "Unknown"}\nType: ${user.type}\nID: ${user.id}${email}` },
					],
					details: { tool: "notion_get_me" } satisfies NotionToolDetails,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Notion error: ${message}` }],
					isError: true,
					details: { tool: "notion_get_me", error: message } satisfies NotionToolDetails & { error: string },
				};
			}
		},
	});
}
