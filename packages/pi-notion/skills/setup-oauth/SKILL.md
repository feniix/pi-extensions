---
description: Guide the user through setting up OAuth authentication for Notion
---

# Setup Notion OAuth

Guide the user through setting up OAuth authentication for Notion.

## When to Use

Use this skill when the user:
- Wants to connect pi to Notion with OAuth
- Says "setup notion", "connect notion", "notion oauth", or similar
- Has Notion OAuth credentials and needs help configuring them
- Gets errors about Notion token not being configured

## Steps

### Step 1: Check Current Status

First, check if OAuth is already configured:

```
Use notion_oauth_status to check the current OAuth status.
```

### Step 2: Explain the Requirement

If not configured, explain:

```
Notion OAuth provides a better experience than manual tokens:
✅ Automatic token refresh (no expired token errors)
✅ User-based authorization (not tied to your account)
✅ No need to manage API tokens manually

This takes about 2 minutes.
```

### Step 3: Guide User to Create Public Integration

Walk the user through creating a Notion public integration:

1. **Create a Public Integration**
   - Go to: https://www.notion.so/profile/integrations
   - Click **"New integration"**
   - Select **"Public"** as the type
   - Give it a name (e.g., "pi Notion")

2. **Configure OAuth Settings**
   - Go to the **OAuth** section in integration settings
   - Add redirect URI: `http://localhost:3000/callback`
   - Save

3. **Copy Credentials**
   - From the **Configuration** tab, copy:
     - **OAuth Client ID**
     - **OAuth Client Secret**

### Step 4: Configure the Extension

Ask the user for their credentials, then create the config:

```
Create or update ~/.pi/agent/extensions/notion.json with:

{
  "oauth": {
    "clientId": "your-client-id",
    "clientSecret": "your-client-secret",
    "redirectUri": "http://localhost:3000/callback"
  }
}
```

### Step 5: Run OAuth Authorization

```
Use notion_oauth_setup to start the authorization flow.
```

This will:
1. Open Notion's authorization page in your browser
2. Wait for you to approve access
3. Exchange the code for tokens automatically
4. Show you the connected workspace

### Step 6: Verify

```
Use notion_oauth_status to verify the connection.
```

## Example Config

```json
{
  "oauth": {
    "clientId": "463558a3-725e-4f37-b6d3-0889894f68de",
    "clientSecret": "secret_xxx",
    "redirectUri": "http://localhost:3000/callback"
  }
}
```

## Troubleshooting

| Error | Solution |
|-------|----------|
| "OAuth not configured" | Add oauth section to notion.json |
| "State mismatch" | Try again (possible timing issue) |
| "Port in use" | Something else is using port 3000 |
| Token expires | Run notion_oauth_setup again to re-authorize |

## Cleanup

To disconnect:

```
Use notion_oauth_logout to clear tokens and disconnect.
```
