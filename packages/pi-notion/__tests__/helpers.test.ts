import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  formatBlocks,
  formatDatabase,
  formatPage,
  formatSearch,
  getTitleFromProperties,
  loadConfig,
  resolveConfigPath,
} from "../extensions/index.js";

describe("pi-notion resolveConfigPath", () => {
  it("resolves paths starting with ~/", () => {
    const result = resolveConfigPath("~/.pi/config.json");
    expect(result).toContain(homedir());
    expect(result).toContain(".pi/config.json");
  });

  it("resolves paths starting with ~", () => {
    const result = resolveConfigPath("~/.pi/config.json");
    expect(result).toContain(".pi/config.json");
  });

  it("returns absolute paths as-is", () => {
    const absolute = "/absolute/path/to/config.json";
    expect(resolveConfigPath(absolute)).toBe(absolute);
  });

  it("resolves relative paths from cwd", () => {
    const result = resolveConfigPath("relative/path.json");
    expect(result).toBe(resolve(process.cwd(), "relative/path.json"));
  });

  it("handles whitespace in paths", () => {
    const result = resolveConfigPath("  ~/.pi/config.json  ");
    expect(result).toContain(".pi/config.json");
  });

  it("handles path with only tilde", () => {
    const result = resolveConfigPath("~");
    expect(result).toBe(homedir());
  });
});

describe("pi-notion getTitleFromProperties", () => {
  it("extracts title from property with type title", () => {
    const props = { Name: { type: "title", title: [{ plain_text: "My Page" }] } };
    expect(getTitleFromProperties(props)).toBe("My Page");
  });

  it("extracts title from another title property", () => {
    const props = { Title: { type: "title", title: [{ plain_text: "Another Page" }] } };
    expect(getTitleFromProperties(props)).toBe("Another Page");
  });

  it("returns Untitled when no title found", () => {
    expect(getTitleFromProperties({})).toBe("Untitled");
    expect(getTitleFromProperties({ other: { type: "text", text: "test" } })).toBe("Untitled");
  });

  it("handles empty title array", () => {
    expect(getTitleFromProperties({ Name: { type: "title", title: [] } })).toBe("Untitled");
  });

  it("handles multiple text parts", () => {
    const props = {
      Name: {
        type: "title",
        title: [{ plain_text: "Part 1 " }, { plain_text: "Part 2" }],
      },
    };
    expect(getTitleFromProperties(props)).toBe("Part 1 Part 2");
  });

  it("finds title in nested properties", () => {
    const props = {
      Status: { type: "status" },
      Name: { type: "title", title: [{ plain_text: "Nested Title" }] },
      Description: { type: "rich_text" },
    };
    expect(getTitleFromProperties(props)).toBe("Nested Title");
  });
});

describe("pi-notion formatPage", () => {
  it("formats page with properties", () => {
    const page = {
      id: "abc123",
      url: "https://notion.so/abc123",
      properties: { Name: { title: [{ plain_text: "Test Page" }] } },
    };
    const result = formatPage(page);
    expect(result).toContain("Test Page");
    expect(result).toContain("abc123");
  });

  it("handles page without properties", () => {
    const page = { id: "abc123", url: "https://notion.so/abc123", properties: {} };
    const result = formatPage(page);
    expect(result).toContain("Untitled");
  });

  it("formats page with title property", () => {
    const page = {
      id: "xyz789",
      url: "https://notion.so/xyz789",
      properties: { title: { title: [{ plain_text: "Title Property" }] } },
    };
    const result = formatPage(page);
    expect(result).toContain("Title Property");
  });

  it("formats page with multiple properties", () => {
    const page = {
      id: "multi",
      url: "https://notion.so/multi",
      properties: {
        Name: { title: [{ plain_text: "Multi Page" }] },
        Status: { status: { name: "Active" } },
        Date: { date: { start: "2025-01-01" } },
      },
    };
    const result = formatPage(page);
    expect(result).toContain("Multi Page");
    expect(result).toContain("## Properties");
  });
});

describe("pi-notion formatDatabase", () => {
  it("formats database", () => {
    const db = {
      id: "def456",
      title: [{ plain_text: "Test Database" }],
      properties: { Name: {}, Status: {} },
    };
    const result = formatDatabase(db);
    expect(result).toContain("Test Database");
    expect(result).toContain("def456");
  });

  it("handles empty title", () => {
    const db = { id: "def456", title: [], properties: {} };
    const result = formatDatabase(db);
    expect(result).toContain("Untitled");
    expect(result).toContain("def456");
  });

  it("formats database with multiple properties", () => {
    const db = {
      id: "db123",
      title: [{ plain_text: "Multi Property DB" }],
      properties: {
        Name: { type: "title" },
        Status: { type: "status" },
        Count: { type: "number" },
      },
    };
    const result = formatDatabase(db);
    expect(result).toContain("Multi Property DB");
    expect(result).toContain("Name");
    expect(result).toContain("Status");
  });

  it("handles undefined title", () => {
    const db = { id: "no-title", title: undefined, properties: {} };
    const result = formatDatabase(db);
    expect(result).toContain("Untitled");
  });
});

describe("pi-notion formatBlocks", () => {
  it("formats blocks", () => {
    const result = formatBlocks({
      results: [
        { type: "paragraph", id: "1", paragraph: { text: [{ plain_text: "Hello" }] } },
        { type: "heading_1", id: "2", heading_1: { text: [{ plain_text: "Title" }] } },
      ],
    });
    expect(result).toContain("paragraph");
    expect(result).toContain("Hello");
    expect(result).toContain("Title");
  });

  it("handles empty results", () => {
    const result = formatBlocks({ results: [] });
    expect(result).toBe("No blocks found.");
  });

  it("handles unknown block types", () => {
    const result = formatBlocks({
      results: [{ type: "unknown_type", id: "1" }],
    });
    expect(result).toContain("unknown_type");
  });

  it("handles blocks with empty content", () => {
    const result = formatBlocks({
      results: [
        { type: "paragraph", id: "1", paragraph: {} },
        { type: "code", id: "2", code: { text: [] } },
      ],
    });
    expect(result).toContain("paragraph");
    expect(result).toContain("code");
  });

  it("handles null results", () => {
    const result = formatBlocks({ results: null as unknown as [] });
    expect(result).toBe("No blocks found.");
  });

  it("handles blocks with multiple text items", () => {
    const result = formatBlocks({
      results: [
        {
          type: "paragraph",
          id: "1",
          paragraph: { text: [{ plain_text: "Part 1" }, { plain_text: "Part 2" }] },
        },
      ],
    });
    expect(result).toContain("Part 1");
    expect(result).toContain("Part 2");
  });
});

describe("pi-notion formatSearch", () => {
  it("formats search results", () => {
    const result = formatSearch({
      results: [
        { object: "page", id: "1", properties: { Name: { title: [{ plain_text: "Page 1" }] } } },
        { object: "database", id: "2", title: [{ plain_text: "DB 1" }] },
      ],
    });
    expect(result).toContain("page");
    expect(result).toContain("Untitled"); // depends on how title is extracted
    expect(result).toContain("database");
  });

  it("handles empty results", () => {
    const result = formatSearch({ results: [] });
    expect(result).toBe("No results found.");
  });
});

describe("pi-notion loadConfig", () => {
  it("returns null when no config exists", () => {
    const base = mkdtempSync(join(tmpdir(), "pi-notion-load-"));
    const configPath = join(base, "nonexistent.json");
    const result = loadConfig(configPath);
    expect(result).toBeNull();
  });

  it("loads valid config file", () => {
    const base = mkdtempSync(join(tmpdir(), "pi-notion-load-valid-"));
    const configPath = join(base, "notion.json");
    const config = { token: "test-token-123", oauth: null };
    writeFileSync(configPath, JSON.stringify(config), "utf-8");

    const result = loadConfig(configPath);
    expect(result?.token).toBe("test-token-123");
  });

  it("handles invalid JSON gracefully", () => {
    const base = mkdtempSync(join(tmpdir(), "pi-notion-load-invalid-"));
    const configPath = join(base, "invalid.json");
    writeFileSync(configPath, "not valid json", "utf-8");

    const result = loadConfig(configPath);
    expect(result).toBeNull();
  });

  it("loads from NOTION_CONFIG_FILE when set", () => {
    const base = mkdtempSync(join(tmpdir(), "pi-notion-load-env-file-"));
    const configPath = join(base, "notion-config.json");
    const original = process.env.NOTION_CONFIG_FILE;
    writeFileSync(configPath, JSON.stringify({ token: "env-file-token" }), "utf-8");
    process.env.NOTION_CONFIG_FILE = configPath;

    try {
      expect(loadConfig(undefined)).toEqual({ token: "env-file-token" });
    } finally {
      if (original) process.env.NOTION_CONFIG_FILE = original;
      else delete process.env.NOTION_CONFIG_FILE;
    }
  });

  it("supports deprecated NOTION_CONFIG with warning", () => {
    const base = mkdtempSync(join(tmpdir(), "pi-notion-load-env-legacy-"));
    const configPath = join(base, "notion-config.json");
    const original = process.env.NOTION_CONFIG;
    const originalFile = process.env.NOTION_CONFIG_FILE;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    writeFileSync(configPath, JSON.stringify({ token: "legacy-env-token" }), "utf-8");
    delete process.env.NOTION_CONFIG_FILE;
    process.env.NOTION_CONFIG = configPath;

    try {
      expect(loadConfig(undefined)).toEqual({ token: "legacy-env-token" });
      expect(warnSpy).toHaveBeenCalledWith("[pi-notion] NOTION_CONFIG is deprecated; use NOTION_CONFIG_FILE.");
    } finally {
      warnSpy.mockRestore();
      if (original) process.env.NOTION_CONFIG = original;
      else delete process.env.NOTION_CONFIG;
      if (originalFile) process.env.NOTION_CONFIG_FILE = originalFile;
      else delete process.env.NOTION_CONFIG_FILE;
    }
  });

  it("returns null when no custom config path is provided", () => {
    const result = loadConfig(undefined);
    expect(result).toBeNull();
  });
});

describe("pi-notion checkNotionAuth", () => {
  async function withIsolatedAuthEnv<T>(
    run: (paths: { tempHome: string; tempProject: string }) => Promise<T>,
    options?: { apiKey?: string; tempPrefix?: string },
  ): Promise<T> {
    const originalHome = process.env.HOME;
    const originalApiKey = process.env.NOTION_API_KEY;
    const originalToken = process.env.NOTION_TOKEN;
    const originalMcpAuthFile = process.env.NOTION_MCP_AUTH_FILE;
    const originalLegacyMcpAuthFile = process.env.NOTION_MCP_AUTH;
    const originalCwd = process.cwd();
    const tempPrefix = options?.tempPrefix ?? "pi-notion-auth";
    const tempHome = mkdtempSync(join(tmpdir(), `${tempPrefix}-home-`));
    const tempProject = mkdtempSync(join(tmpdir(), `${tempPrefix}-project-`));

    mkdirSync(join(tempHome, ".pi", "agent"), { recursive: true });
    mkdirSync(join(tempProject, ".pi"), { recursive: true });

    process.env.HOME = tempHome;
    process.chdir(tempProject);
    delete process.env.NOTION_MCP_AUTH_FILE;
    delete process.env.NOTION_MCP_AUTH;
    delete process.env.NOTION_TOKEN;
    if (options?.apiKey) process.env.NOTION_API_KEY = options.apiKey;
    else delete process.env.NOTION_API_KEY;

    vi.resetModules();

    try {
      return await run({ tempHome, tempProject });
    } finally {
      process.chdir(originalCwd);
      if (originalHome) process.env.HOME = originalHome;
      else delete process.env.HOME;
      if (originalApiKey) process.env.NOTION_API_KEY = originalApiKey;
      else delete process.env.NOTION_API_KEY;
      if (originalToken) process.env.NOTION_TOKEN = originalToken;
      else delete process.env.NOTION_TOKEN;
      if (originalMcpAuthFile) process.env.NOTION_MCP_AUTH_FILE = originalMcpAuthFile;
      else delete process.env.NOTION_MCP_AUTH_FILE;
      if (originalLegacyMcpAuthFile) process.env.NOTION_MCP_AUTH = originalLegacyMcpAuthFile;
      else delete process.env.NOTION_MCP_AUTH;
    }
  }

  async function importCheckNotionAuthInIsolatedEnv(apiKey?: string) {
    return withIsolatedAuthEnv(async () => {
      const { checkNotionAuth } = await import("../extensions/index.js");
      return checkNotionAuth();
    }, { apiKey });
  }

  it("returns not authenticated when no config exists", async () => {
    const result = await importCheckNotionAuthInIsolatedEnv();
    expect(result.authenticated).toBe(false);
    expect(result.message).toContain("Not authenticated");
  });

  it("migrates legacy MCP auth file to the new filename", async () => {
    await withIsolatedAuthEnv(
      async ({ tempHome }) => {
        const configDir = join(tempHome, ".pi", "agent", "extensions");
        const agentDir = join(tempHome, ".pi", "agent");

        mkdirSync(configDir, { recursive: true });
        writeFileSync(
          join(configDir, "notion-mcp.json"),
          JSON.stringify({ mcpUrl: "https://mcp.notion.com/mcp", accessToken: "token-123" }),
          "utf-8",
        );

        const mod = await import("../extensions/index.js");
        const result = mod.checkNotionAuth();
        expect(result.authenticated).toBe(true);
        expect(existsSync(join(configDir, "notion-mcp.json"))).toBe(false);
        expect(existsSync(join(configDir, "notion-mcp-auth.json"))).toBe(false);
        expect(existsSync(join(agentDir, "notion-mcp-auth.json"))).toBe(true);
      },
      { tempPrefix: "pi-notion-migrate" },
    );
  });

  it("detects NOTION_API_KEY but still requires MCP auth", async () => {
    const result = await importCheckNotionAuthInIsolatedEnv("test-key");
    expect(result.authenticated).toBe(false);
    expect(result.message).toContain("NOTION_API_KEY");
    expect(result.message).toContain("MCP OAuth is still required");
  });
});

describe("pi-notion tool guardrails", async () => {
  const { toolChecks } = await import("../extensions/index.js");

  describe("checkNotionSearch", () => {
    it("warns when content_search_mode is not workspace_search", () => {
      const warnings = toolChecks["notion-search"]({ query: "test", filters: {} });
      expect(warnings.some((w: string) => w.includes("content_search_mode"))).toBe(true);
    });

    it("warns when filters key is missing", () => {
      const warnings = toolChecks["notion-search"]({ query: "test", content_search_mode: "workspace_search" });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("filters");
    });

    it("returns no warnings when correctly configured", () => {
      const warnings = toolChecks["notion-search"]({
        query: "test",
        content_search_mode: "workspace_search",
        filters: {},
      });
      expect(warnings).toHaveLength(0);
    });
  });

  describe("checkNotionFetch", () => {
    it("warns when using view:// URLs", () => {
      const warnings = toolChecks["notion-fetch"]({ id: "view://abc123" });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("view://");
    });

    it("warns when using raw ID instead of URL", () => {
      const warnings = toolChecks["notion-fetch"]({ id: "abc123def456" });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("raw ID");
    });

    it("returns no warnings for https URLs", () => {
      const warnings = toolChecks["notion-fetch"]({ id: "https://notion.so/page123" });
      expect(warnings).toHaveLength(0);
    });
  });

  describe("checkMeetingNotes", () => {
    it("warns when filter is missing", () => {
      const warnings = toolChecks["notion-query-meeting-notes"]({});
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("filter");
    });

    it("warns when filter is empty object", () => {
      const warnings = toolChecks["notion-query-meeting-notes"]({ filter: {} });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("operator");
    });

    it("returns no warnings when filter has operator", () => {
      const warnings = toolChecks["notion-query-meeting-notes"]({
        filter: { operator: "and", filters: [] },
      });
      expect(warnings).toHaveLength(0);
    });
  });
});
