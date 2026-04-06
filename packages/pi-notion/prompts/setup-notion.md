---
description: "Interactive setup for Notion OAuth — guides user through creating a public integration and configuring OAuth for pi"
---

# /setup-notion

Interactively set up Notion OAuth authentication for pi.

**Use when**: User wants to connect pi to Notion via OAuth. This is the recommended method for full workspace access.

## Step 1: Explain the Requirement

Tell the user:

```
To use Notion with pi via OAuth, you need to create a public Notion integration.
This allows pi to access your Notion workspace with your permission.

This takes about 3 minutes.
```

## Step 2: Create a Public Integration

Walk the user through creating a Notion OAuth integration:

1. **Open Notion Integrations**
   - Go to: https://www.notion.so/profile/integrations
   - Click "New integration"

2. **Configure the Integration**
   - **Name**: `pi` (or any name you prefer)
   - **Associated workspace**: Select your workspace
   - **Type**: Select **Public** (important - OAuth requires public integrations)
   - Submit to create

3. **Configure OAuth Settings** (appears after setting Type to Public)
   - Under **Redirect URIs**, add: `http://localhost:3000/callback`
   - Add any additional redirect URIs if needed

4. **Copy OAuth Credentials**
   - In the integration settings, find **OAuth Client ID** and **OAuth Client Secret**
   - Copy both values

## Step 3: Configure pi

Ask the user for their OAuth credentials, then create the config file.

Create or update `~/.pi/agent/extensions/notion.json`:

```json
{
  "oauth": {
    "clientId": "your-oauth-client-id",
    "clientSecret": "your-oauth-client-secret",
    "redirectUri": "http://localhost:3000/callback"
  }
}
```

Alternatively, you can use the `--notion-config` flag to specify a custom path.

## Step 4: Authorize pi

After configuration, the user needs to authorize pi:

1. Run the `/notion` command or use the `notion_mcp_connect` tool
2. A browser window will open for Notion authorization
3. Select which pages/databases to share with pi
4. Click "Allow access"

## Step 5: Verify the Setup

After authorization, test with:

```
Use notion_mcp_status to verify the connection works.
```

If successful, confirm:

```
✅ Notion OAuth is connected! You can now use Notion tools like:
- notion_search — find pages and databases
- notion_get_page — retrieve page content
- notion_create_page — create new pages
```

## Troubleshooting

| Error | Solution |
|-------|----------|
| "redirect_uri mismatch" | Ensure redirect URI is exactly `http://localhost:3000/callback` in Notion settings |
| "Invalid client" | Check that clientId and clientSecret are correct |
| "access_denied" | User cancelled authorization - run /notion again |
| "No access token" | Complete the OAuth flow by running /notion |

## Important Notes

- **Public vs Internal**: OAuth requires a **Public** integration type, not Internal
- **Redirect URI**: Must match exactly what you configured in Notion
- **Page Access**: Users can select which pages to share during the OAuth flow
- **Multiple Users**: Each user needs their own OAuth authorization

## Example: Finding a Page ID

Page IDs are in the Notion URL:
```
https://notion.so/workspace/Page-Title-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
                                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                          This is the page ID (32 chars, with hyphens)
```

Database IDs look the same but start with the database icon.
