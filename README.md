# @pipeworx/uk-contracts

UK government procurement — what the public sector bought, who supplied it,
and for how much — across both the general-tender Contracts Finder and the
above-threshold Find a Tender Service. One pack, both sources (fleet #3244
confirmed this boundary rather than splitting them): they publish the same
OCDS format under the same Cabinet Office programme, and Find a Tender is
specifically the high-value tier of the same regime Contracts Finder covers.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1866+ live data sources. This is an independent, unofficial integration — not affiliated with, endorsed by, or published by the upstream provider.

## Tools

- `search_notices(keyword?, status?, notice_type?, published_from?, published_to?, limit?)` — full-text search of Contracts Finder (title, description, awarded supplier), with real historical date filtering.
- `get_notice(id)` — full detail for one Contracts Finder notice.
- `recent_notices(stage?, limit?)` — most recent Contracts Finder notices, newest-first.
- `find_a_tender_recent(keyword?, stage?, days?, limit?)` — Find a Tender Service notices, newest-first within the requested window — now also usable for a historical window (`days` up to ~3660), not just "recent".
- `find_a_tender_notice(ocid)` — full detail for one Find a Tender Service notice.

Every response carries enough provenance to tell a complete scan from a
partial one (`total_matches` / `window_complete` + `scanned`/`pages_walked`).
A zero count is only trustworthy when the window was fully examined — see
notes below.

## Auth

Keyless.

## Data sources

- Cabinet Office, Contracts Finder — general UK public-sector procurement notices and awards, OCDS format.
- Cabinet Office, Find a Tender Service — above-threshold (high-value) UK public-sector procurement notices and awards, OCDS format; the post-Brexit replacement for the UK's share of EU TED.

## Notes for the next person

**Two APIs, and the search one is not the OCDS one (fleet #607).** Contracts Finder's OCDS feed (`/Published/Notices/OCDS/Search`) is a date-ordered feed with NO text search — and it does not reject an unrecognised `keyword` parameter either, so a typo'd filter silently returns the unfiltered feed rather than erroring. The real search is a POST to the REST search endpoint with a `searchCriteria` object, which does proper server-side text search. Mind the silent criterion the same way: `{keywords:[...]}` (plural) or a bare top-level `keyword` both return the full, unfiltered hit count with a 200 — only the correctly-nested `{searchCriteria:{keyword:...}}` shape filters.

**Mind the two id spaces.** A `search_notices` hit's `id` is a bare GUID and 404s against the OCDS release endpoint; `recent_notices` returns an OCDS release id (`{guid}-{seq}`) instead. `get_notice` tries both forms for you.

**Find a Tender Service has no server-side text search at all** — its API rejects a `keyword` parameter outright, accepting only `stages`/`limit`/`cursor`/`updatedFrom`/`updatedTo`. `find_a_tender_recent` matches a keyword client-side over the pages it actually walks, bounded to 8 pages per call (FTS rate-limits at 12 requests/120 seconds) — `window_complete:false` means the walk stopped with more feed left, so a zero result means "absent from what was examined", not "not published".

**The historical-reach cap on `find_a_tender_recent`'s `days` argument was ours, not upstream's (fleet #3244).** FTS's own `updatedFrom` accepts any date years back with no error — verified live. The argument used to clamp at 30, which silently refused anything older; it is now ~3660 (about 10 years), still subject to the same 8-page walk cap per call. For a proper full-corpus historical date range with no page-walk bound, use `search_notices` (Contracts Finder) instead — its date filtering is a real server-side query, not a bounded feed walk.

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

Both URLs reach the same gateway and the same 1866+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/uk_contracts_search_notices \
  -H 'Content-Type: application/json' \
  -d '{"keyword":"MRI","limit":20}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/uk_contracts_search_notices`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Run it from npm

`@pipeworx/mcp-uk-contracts` is a local stdio bridge to the Pipeworx gateway: your MCP client
starts it with `npx`, and it forwards every call to the same
`https://gateway.pipeworx.io/uk-contracts/mcp` endpoint shown above. It needs network access;
there is no offline mode.

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

Without a key it calls anonymously, capped at 50 calls a day. A free account
raises that to 200 a day: get a key at https://pipeworx.io/signup and add
`"env": { "PIPEWORX_API_KEY": "<your key>" }` to the server entry.
The key is sent as a Bearer token, the same way a hosted connection sends it,
so calls are metered and billed exactly as they are there.

It lists **only** this pack's tools by default. Set `PIPEWORX_META_TOOLS=1` to
also list `ask_pipeworx` and the other gateway-wide tools.

Behind an HTTPS proxy: Node's built-in `fetch` does not read `HTTPS_PROXY` by
default. Newer Node releases honour it when `NODE_USE_ENV_PROXY=1` is set; check
your Node version's documentation.

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
