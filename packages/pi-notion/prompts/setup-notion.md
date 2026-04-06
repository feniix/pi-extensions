---
description: "Interactive setup for Notion MCP connection — guides user through OAuth authorization"
---

# /setup-notion

Interactively set up Notion MCP connection for pi.

**Use when**: User wants to connect pi to Notion via the official Notion MCP server.

## Step 1: Explain the Setup

Tell the user:

```
Notion MCP provides full access to your Notion workspace through an official
connection. No API keys or manual configuration needed!

Just run /notion and authorize in your browser - it takes about 30 seconds.
```

## Step 2: Connect

The user just needs to run:

```
/notion
```

This will:
1. Open a browser window for Notion authorization
2. User selects which pages to share with pi
3. pi automatically connects to Notion MCP

## Step 3: Verify

After connection, test with:

```
Use notion_mcp_status to verify the connection works.
```

If successful, confirm:

```
✅ Notion is connected! You can now use Notion tools like:
- Search your Notion workspace
- Get page content
- Create and update pages
```

## No Manual Setup Required

Unlike traditional API integrations, Notion MCP uses dynamic OAuth:

- **No API keys to copy**
- **No integration creation needed**
- **No redirect URI configuration**

The connection handles all of this automatically.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Browser didn't open | Check popup blockers, try again |
| "State mismatch" error | Clear browser cookies and try again |
| Connection drops | Run /notion to reconnect |
| Need to reauthorize | Use notion_mcp_disconnect then /notion |

## Sharing Pages

During OAuth authorization, users select which pages/databases to share.
To share more pages later:

1. Open Notion
2. Go to Settings → Connections
3. Find "pi" and manage page access

## Token Refresh

Tokens refresh automatically. No user action needed.
