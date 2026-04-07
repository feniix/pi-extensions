---
description: Guide the user through setting up Notion MCP with OAuth authentication
---

# Setup Notion MCP

Connect pi to Notion using the official MCP (Model Context Protocol) server.

## When to Use

Use this skill when the user:
- Wants to connect pi to Notion
- Says "setup notion", "connect notion", "notion oauth", or similar
- Gets errors about Notion not being configured
- Asks to search or access their Notion workspace

## Quick Start

### Step 1: Check Current Status

```
Use notion_mcp_status to check if already connected.
```

### Step 2: Connect (if not connected)

```
Run the /notion command to start the OAuth flow.
```

This will:
1. Open Notion's authorization page in your browser
2. Wait for you to approve access
3. Automatically complete the OAuth flow
4. Connect to Notion MCP

### Step 3: Verify

```
Use notion_mcp_status to verify the connection.
```

## After Connecting

Once connected, use the **workspace-explorer** skill to learn how to:
- Search for pages and databases
- Read page content
- Query databases
- Create and update pages

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Not connected" | Run `/notion` command |
| Connection failed | Try again - OAuth may have timed out |
| Token expired | Run `/notion` to re-authenticate |
| Need to switch workspace | Disconnect first, then reconnect |

## Disconnect

```
Use notion_mcp_disconnect to disconnect from Notion MCP.
```
