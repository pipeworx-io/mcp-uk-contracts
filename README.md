# mcp-uk-contracts

UK Contracts Finder MCP.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1684+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `search_notices` | Full-text search of UK government procurement from Contracts Finder (Cabinet Office) — what the public sector bought, who supplied it, and for how much, plus open opportunities still out to tender. Covers NHS trusts, councils, police forces, universities and central government departments. Search by keyword ("MRI scanner", "agency nursing", "school catering", "cloud hosting") across notice title, description and awarded supplier, and narrow by publication date. Returns awarded contracts with supplier name and contract value by default, because a question about "contracts" usually means what was actually awarded. Keyless. The UK complement to EU tenders. |
| `get_notice` | Get the full detail for a single UK Contracts Finder notice by the `id` returned by search_notices or recent_notices. Returns the complete (untruncated) description, buyer, contract value, awarded supplier, CPV classification, region, tender period and contact where published. Accepts either id form — search_notices returns a bare GUID and recent_notices an OCDS release id ("{guid}-{seq}"); they are separate id spaces on separate endpoints, and this tool routes to the right one for you. Keyless. |
| `recent_notices` | List the most recent UK procurement notices from Contracts Finder, newest-first, optionally filtered by stage (tender/award). Same compact shape as search_notices. Keyless. |
| `find_a_tender_recent` | Recent HIGH-VALUE UK government tenders and contract awards from the Find a Tender Service (find-tender.service.gov.uk) — the UK's above-threshold procurement portal (the post-Brexit replacement for EU TED, for larger public contracts). Use for "high value UK tenders", "above threshold UK government contracts", "Find a Tender notices", "large UK public sector contract opportunities". Returns recent notices newest-first. An optional keyword is matched over title, description, award title and AWARDED SUPPLIER — client-side, because the FTS API has no text search (it rejects a keyword parameter outright, allowing only stages/limit/cursor/updatedFrom/updatedTo). ALWAYS READ `window_complete`: false means the walk stopped at the page cap with more feed left, so a zero means "absent from the notices examined", not "not published" — narrow `days` until it is true. For a proper full-corpus keyword SEARCH of UK procurement, and for lower-value notices, use search_notices (Contracts Finder), which does have a real server-side index. Keyless. |
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

Both URLs reach the same gateway and the same 1684+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/uk_contracts_search_notices \
  -H 'Content-Type: application/json' \
  -d '{"keyword":"MRI","limit":20}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/uk_contracts_search_notices`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Standalone (no gateway account)

This package also runs as a local stdio MCP server — no Pipeworx account, no
gateway round-trip:

```json
{
  "mcpServers": {
    "uk-contracts": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-uk-contracts"]
    }
  }
}
```

Or run it directly to confirm it starts:

```bash
npx -y @pipeworx/mcp-uk-contracts
```

It speaks MCP over stdin/stdout and answers `initialize`/`tools/list`/`tools/call`
for **only** this pack's tools — none of the shared meta-tools the gateway
connection above adds. Same source, same tools, no ask_pipeworx routing.

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
