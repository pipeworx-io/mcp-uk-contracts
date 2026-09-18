# mcp-uk-contracts

UK Contracts Finder MCP.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1476+ live data sources.

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

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/uk-contracts/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1476+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Uk Contracts data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/uk_contracts_search_notices \
  -H 'Content-Type: application/json' \
  -d '{"keyword":"MRI","limit":20}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/uk_contracts_search_notices`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.
