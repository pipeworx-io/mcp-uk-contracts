# mcp-uk-contracts

UK Contracts Finder MCP.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `search_notices` | Search UK government procurement notices (open tenders + awarded contracts) from Contracts Finder, published as OCDS by the Cabinet Office. Filter by stage and an optional published-date range; results are newest-first. Keyless. The UK complement to EU tenders. Note: there is no server-side keyword filter — pass a `keyword` to filter client-side over title/description of the returned window. |
| `get_notice` | Get the full OCDS detail for a single UK Contracts Finder notice by its release `id` (the `id` field returned by search_notices / recent_notices, format "{guid}-{seq}"). Returns title, full description, buyer, value, CPV classification, tender period, and any awards with suppliers. Keyless. |
| `recent_notices` | List the most recent UK procurement notices from Contracts Finder, newest-first, optionally filtered by stage (tender/award). Same compact shape as search_notices. Keyless. |
| `find_a_tender_recent` | Recent HIGH-VALUE UK government tenders and contract awards from the Find a Tender Service (find-tender.service.gov.uk) — the UK's above-threshold procurement portal (the post-Brexit replacement for EU TED, for larger public contracts). Use for "high value UK tenders", "above threshold UK government contracts", "Find a Tender notices", "large UK public sector contract opportunities". Returns recent notices newest-first; an optional keyword filters them by title/description (client-side, since the FTS feed has no server search). For lower-value / general UK notices use search_notices (Contracts Finder). Keyless. |
| `find_a_tender_notice` | Full detail for one Find a Tender Service (high-value UK) notice by its OCID (e.g. "ocds-h6vhtk-06d27d", from find_a_tender_recent results). Returns title, buyer, description, CPV classification, value, deadlines, and documents. Keyless. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "uk-contracts": {
      "url": "https://gateway.pipeworx.io/uk-contracts/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Uk Contracts data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
