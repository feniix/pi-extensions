---
description: "Interactive setup for Notion API integration — guides user through creating an integration and configuring the token"
---

# /setup-notion

Interactively set up the Notion API integration for pi.

**Use when**: User wants to connect pi to Notion but hasn't configured the integration token yet.

## Step 1: Explain the Requirement

Tell the user:

```
To use Notion with pi, you need a Notion integration token. An integration is like an API key that allows pi to access your Notion workspace.

This takes about 2 minutes.
```

## Step 2: Guide Token Creation

Walk the user through creating a Notion integration:

1. **Open Notion Integrations**
   - Go to: https://www.notion.so/profile/integrations
   - Click "New integration"

2. **Configure the Integration**
   - **Name**: `pi` (or any name you prefer)
   - **Associated workspace**: Select your workspace
   - **Type**: Internal (for personal use)
   - **Submit** to create

3. **Copy the Token**
   - On the integration page, click "Show" under the Internal Integration Secret
   - Copy the token (starts with `secret_...`)

## Step 3: Share a Page (Required)

Tell the user:

```
Important: By default, integrations can only access pages explicitly shared with them.

To test the integration:
1. Open any page in Notion
2. Click the "..." menu → "Add connections"
3. Search for your integration name ("pi") and add it
```

## Step 4: Configure the Token

Ask the user for their token, then offer these options:

### Option A: Environment Variable (Recommended)

```bash
export NOTION_TOKEN="secret_xxxx_your_token_here"
```

For persistent setup, add to shell profile (`~/.zshrc`, `~/.bashrc`, etc.)

### Option B: Config File

Create `~/.pi/agent/extensions/notion.json`:

```json
{
  "token": "secret_xxxx_your_token_here"
}
```

## Step 5: Verify the Setup

After configuration, test with:

```
Use notion_get_me to verify the connection works.
```

If successful, confirm:

```
✅ Notion is connected! You can now use Notion tools like:
- notion_search — find pages and databases
- notion_get_page — retrieve page content
- notion_create_page — create new pages
```

## Troubleshooting

| Error | Solution |
|-------|----------|
| "Could not find integration" | Share a page with the integration first |
| "Unauthorized" | Verify the token is correct and not expired |
| "Object not found" | The page ID may be incorrect; check the URL in Notion |

## Example: Finding a Page ID

Page IDs are in the Notion URL:
```
https://notion.so/workspace/Page-Title-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
                                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                          This is the page ID (32 chars, with hyphens)
```

Database IDs look the same but start with the database icon.
