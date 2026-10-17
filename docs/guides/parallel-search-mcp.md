# Contributor web research with Parallel Search MCP

When working on an extension, use [Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp)
to look up current APIs and read public documentation in Claude Code. It provides
`web_search` and `web_fetch` without a Parallel account or API key. Anonymous
search uses Fast mode and is free for light use, with rate limits.

This setup is for contributors using Claude Code. It adds a personal server for
this checkout; it does not configure the published pi extensions or replace their
tools. The repository's shared [MCP configuration](../../.mcp.json) keeps its
existing Exa, Ref.tools, and Serena entries.

## Enable for this checkout

With [Claude Code installed](https://code.claude.com/docs/en/setup), run from the
repository root:

```bash
claude mcp add --scope local --transport http parallel-search https://search.parallel.ai/mcp \
  --header "User-Agent: pi-extensions/parallel-search"
claude mcp get parallel-search
```

Claude Code stores this local-scope entry in your `~/.claude.json` under the
current project's path. It is private to you and leaves the checked-in
`.mcp.json` unchanged. No new environment variables are required. See
[Claude Code's MCP scopes](https://code.claude.com/docs/en/mcp#local-scope)
for configuration details.

Start a new Claude Code session in the checkout, then run `/mcp` and confirm
`parallel-search` is connected. Allow its tools when prompted; the repository's
existing tool permissions do not automatically approve this new server.

## Research an API before changing an extension

Ask Claude Code to use this server explicitly, for example:

```text
Use parallel-search to find current TypeBox documentation on object schemas.
Fetch the most relevant documentation page, then explain how to reject unknown
properties. Include source links so I can check the API before editing a tool.
```

`web_search` finds relevant sources; `web_fetch` reads selected URLs. Queries and
requested URLs are sent to Parallel, so keep this workflow to public information.
Check the linked documentation against the dependency version in the package
you are changing.

If the server is disconnected, check `claude mcp get parallel-search` and `/mcp`.
The anonymous endpoint is `https://search.parallel.ai/mcp`; `/mcp-oauth` requires
authentication. If a tool reports a rate limit, wait as instructed by the response.
The [Search MCP documentation](https://docs.parallel.ai/integrations/mcp/search-mcp)
also covers authenticated setup for higher limits.

## Remove the optional server

Run from the same checkout:

```bash
claude mcp remove --scope local parallel-search
```

Start a new session to use the updated configuration.
