interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * UK Contracts Finder MCP.
 *
 * UK government procurement notices — open tenders and awarded contracts —
 * published as OCDS (Open Contracting Data Standard) by the Cabinet Office.
 * Keyless. The natural UK complement to the EU tenders (ted-eu) pack.
 *
 * Data source: https://www.contractsfinder.service.gov.uk (OCDS API).
 * Notices are returned newest-first; the search endpoint supports an optional
 * publishedFrom/publishedTo date range and a stages filter (tender/award).
 * Full per-notice detail is fetched via the OCDS Release endpoint using the
 * release `id` returned alongside each result.
 */


const BASE = 'https://www.contractsfinder.service.gov.uk';
// Find a Tender Service (FTS) — the UK's HIGH-VALUE / above-threshold tender
// portal (post-Brexit replacement for EU TED). Same OCDS format as Contracts
// Finder, keyless, but a date-ordered FEED (no server-side keyword search).
const FTS_BASE = 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages';
const UA = 'pipeworx/1.0 (+https://pipeworx.io)';

const tools: McpToolExport['tools'] = [
  {
    name: 'search_notices',
    description:
      'Search UK government procurement notices (open tenders + awarded contracts) from Contracts Finder, published as OCDS by the Cabinet Office. Filter by stage and an optional published-date range; results are newest-first. Keyless. The UK complement to EU tenders. Note: there is no server-side keyword filter — pass a `keyword` to filter client-side over title/description of the returned window.',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description:
            'Optional case-insensitive substring filtered client-side over each notice title + description (the API has no keyword search).',
        },
        stage: {
          type: 'string',
          enum: ['tender', 'award'],
          description: 'Notice stage: "tender" (open opportunities) or "award" (awarded contracts). Default "tender".',
        },
        published_from: {
          type: 'string',
          description: 'Optional ISO date (YYYY-MM-DD) lower bound on publication date, e.g. "2026-05-01".',
        },
        published_to: {
          type: 'string',
          description: 'Optional ISO date (YYYY-MM-DD) upper bound on publication date, e.g. "2026-06-01".',
        },
        limit: {
          type: 'number',
          description: 'Max notices to scan/return, 1–100 (default 20).',
        },
      },
    },
  },
  {
    name: 'get_notice',
    description:
      'Get the full OCDS detail for a single UK Contracts Finder notice by its release `id` (the `id` field returned by search_notices / recent_notices, format "{guid}-{seq}"). Returns title, full description, buyer, value, CPV classification, tender period, and any awards with suppliers. Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description:
            'The OCDS release id from a search/recent result, e.g. "a42239ac-faef-4245-ad0f-16b3a787675b-901561".',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'recent_notices',
    description:
      'List the most recent UK procurement notices from Contracts Finder, newest-first, optionally filtered by stage (tender/award). Same compact shape as search_notices. Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        stage: {
          type: 'string',
          enum: ['tender', 'award'],
          description: 'Notice stage: "tender" or "award". Default "tender".',
        },
        limit: {
          type: 'number',
          description: 'Number of recent notices to return, 1–100 (default 20).',
        },
      },
    },
  },
  {
    name: 'find_a_tender_recent',
    description:
      'Recent HIGH-VALUE UK government tenders and contract awards from the Find a Tender Service (find-tender.service.gov.uk) — the UK\'s above-threshold procurement portal (the post-Brexit replacement for EU TED, for larger public contracts). Use for "high value UK tenders", "above threshold UK government contracts", "Find a Tender notices", "large UK public sector contract opportunities". Returns recent notices newest-first; an optional keyword filters them by title/description (client-side, since the FTS feed has no server search). For lower-value / general UK notices use search_notices (Contracts Finder). Keyless.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        keyword: { type: 'string', description: 'Optional keyword to filter recent notices by title/description, e.g. "cloud", "construction". Omit to list all recent.' },
        stage: { type: 'string', enum: ['tender', 'award', 'planning'], description: 'Notice stage: "tender" (open opportunities, default), "award" (results), or "planning".' },
        days: { type: 'number', description: 'How many days back to scan, 1–30 (default 7).' },
        limit: { type: 'number', description: 'Max notices to return, 1–100 (default 20).' },
      },
    },
  },
  {
    name: 'find_a_tender_notice',
    description:
      'Full detail for one Find a Tender Service (high-value UK) notice by its OCID (e.g. "ocds-h6vhtk-06d27d", from find_a_tender_recent results). Returns title, buyer, description, CPV classification, value, deadlines, and documents. Keyless.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ocid: { type: 'string', description: 'The notice OCID, e.g. "ocds-h6vhtk-06d27d". Get these from find_a_tender_recent.' },
      },
      required: ['ocid'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case 'search_notices':
        return searchNotices(args);
      case 'get_notice':
        return getNotice(args);
      case 'recent_notices':
        return recentNotices(args);
      case 'find_a_tender_recent':
        return findATenderRecent(args);
      case 'find_a_tender_notice':
        return findATenderNotice(args);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ---- helpers -------------------------------------------------------------

function clampLimit(v: unknown, def: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(100, Math.max(1, Math.floor(n)));
}

function stageOf(v: unknown): 'tender' | 'award' {
  return v === 'award' ? 'award' : 'tender';
}

function isoDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s : null;
}

function stripHtml(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n).trimEnd()}…` : s;
}

async function getJson(url: string): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (res.status === 404) return { ok: false, error: 'not found' };
  if (!res.ok) return { ok: false, error: `contractsfinder: ${res.status} ${(await res.text()).slice(0, 200)}` };
  return { ok: true, data: await res.json() };
}

type Release = Record<string, any>;

function compactRelease(r: Release): Record<string, unknown> {
  const tender = (r.tender ?? {}) as Record<string, any>;
  const buyer = (r.buyer ?? {}) as Record<string, any>;
  const tag = Array.isArray(r.tag) ? r.tag : [];
  const value = (tender.value ?? {}) as Record<string, any>;
  // notice value can live on tender; awards carry their own value
  const award = Array.isArray(r.awards) && r.awards.length ? (r.awards[0] as Record<string, any>) : null;
  const awardValue = (award?.value ?? {}) as Record<string, any>;
  const v = value.amount != null ? value : awardValue.amount != null ? awardValue : null;
  const doc = Array.isArray(tender.documents) && tender.documents.length ? tender.documents[0] : null;
  const awardDoc = Array.isArray(award?.documents) && award!.documents.length ? award!.documents[0] : null;
  const url = doc?.url ?? awardDoc?.url ?? null;

  return {
    ocid: r.ocid ?? null,
    id: r.id ?? null,
    title: tender.title ?? null,
    buyer: buyer.name ?? null,
    description: truncate(stripHtml(tender.description), 300),
    value: v ? { amount: v.amount ?? null, currency: v.currency ?? null } : null,
    stage: tag.length ? tag[0] : null,
    published_date: tender.datePublished ?? r.date ?? null,
    deadline: tender.tenderPeriod?.endDate ?? null,
    url,
  };
}

function searchUrl(params: {
  stage: 'tender' | 'award';
  limit: number;
  publishedFrom?: string | null;
  publishedTo?: string | null;
}): string {
  const qs = new URLSearchParams();
  qs.set('stages', params.stage);
  qs.set('limit', String(params.limit));
  if (params.publishedFrom) qs.set('publishedFrom', params.publishedFrom);
  if (params.publishedTo) qs.set('publishedTo', params.publishedTo);
  return `${BASE}/Published/Notices/OCDS/Search?${qs.toString()}`;
}

// ---- tools ---------------------------------------------------------------

async function searchNotices(args: Record<string, unknown>): Promise<unknown> {
  const stage = stageOf(args.stage);
  const limit = clampLimit(args.limit, 20);
  const keyword = typeof args.keyword === 'string' ? args.keyword.trim().toLowerCase() : '';
  const publishedFrom = isoDate(args.published_from);
  const publishedTo = isoDate(args.published_to);

  const r = await getJson(searchUrl({ stage, limit, publishedFrom, publishedTo }));
  if (!r.ok) return { error: r.error };

  const releases = (r.data as Record<string, any>)?.releases;
  const list: Release[] = Array.isArray(releases) ? releases : [];
  let compact = list.map(compactRelease);

  if (keyword) {
    compact = compact.filter((c) => {
      const hay = `${c.title ?? ''} ${c.description ?? ''}`.toLowerCase();
      return hay.includes(keyword);
    });
  }

  return {
    count: compact.length,
    stage,
    ...(keyword ? { keyword } : {}),
    ...(publishedFrom ? { published_from: publishedFrom } : {}),
    ...(publishedTo ? { published_to: publishedTo } : {}),
    notices: compact,
  };
}

async function recentNotices(args: Record<string, unknown>): Promise<unknown> {
  const stage = stageOf(args.stage);
  const limit = clampLimit(args.limit, 20);

  const r = await getJson(searchUrl({ stage, limit }));
  if (!r.ok) return { error: r.error };

  const releases = (r.data as Record<string, any>)?.releases;
  const list: Release[] = Array.isArray(releases) ? releases : [];
  return { count: list.length, stage, notices: list.map(compactRelease) };
}

async function getNotice(args: Record<string, unknown>): Promise<unknown> {
  const id = typeof args.id === 'string' ? args.id.trim() : '';
  if (!id) return { error: 'provide a release id (the `id` field from search_notices / recent_notices)' };

  const r = await getJson(`${BASE}/Published/OCDS/Release/${encodeURIComponent(id)}`);
  if (!r.ok) return { error: r.error === 'not found' ? 'notice not found' : r.error, id };

  const releases = (r.data as Record<string, any>)?.releases;
  const rel: Release | undefined = Array.isArray(releases) ? releases[0] : undefined;
  if (!rel) return { error: 'notice not found', id };

  const tender = (rel.tender ?? {}) as Record<string, any>;
  const buyer = (rel.buyer ?? {}) as Record<string, any>;
  const parties = Array.isArray(rel.parties) ? rel.parties : [];
  const awards = Array.isArray(rel.awards) ? rel.awards : [];
  const cls = tender.classification as Record<string, any> | undefined;
  const doc = Array.isArray(tender.documents) && tender.documents.length ? tender.documents[0] : null;

  return {
    ocid: rel.ocid ?? null,
    id: rel.id ?? null,
    title: tender.title ?? null,
    stage: Array.isArray(rel.tag) && rel.tag.length ? rel.tag[0] : null,
    status: tender.status ?? null,
    description: stripHtml(tender.description),
    buyer: buyer.name ?? null,
    parties: parties.map((p: Record<string, any>) => ({ name: p.name, id: p.id })),
    value: tender.value
      ? { amount: tender.value.amount ?? null, currency: tender.value.currency ?? null }
      : null,
    classification: cls ? { scheme: cls.scheme, id: cls.id, description: cls.description } : null,
    procurement_method: tender.procurementMethodDetails ?? tender.procurementMethod ?? null,
    main_category: tender.mainProcurementCategory ?? null,
    tender_period: tender.tenderPeriod ?? null,
    contract_period: tender.contractPeriod ?? null,
    published_date: tender.datePublished ?? rel.date ?? null,
    awards: awards.map((a: Record<string, any>) => ({
      status: a.status ?? null,
      date: a.date ?? null,
      value: a.value ? { amount: a.value.amount ?? null, currency: a.value.currency ?? null } : null,
      suppliers: (Array.isArray(a.suppliers) ? a.suppliers : []).map((s: Record<string, any>) => ({
        name: s.name,
        id: s.id,
      })),
      contract_period: a.contractPeriod ?? null,
    })),
    url: doc?.url ?? null,
  };
}

// ---- Find a Tender Service (FTS) -----------------------------------------

async function findATenderRecent(args: Record<string, unknown>): Promise<unknown> {
  const keyword = String(args.keyword ?? '').trim().toLowerCase();
  const stage = ['tender', 'award', 'planning'].includes(String(args.stage))
    ? String(args.stage)
    : 'tender';
  const days = Math.min(Math.max(Number(args.days) || 7, 1), 30);
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
  const from = new Date(Date.now() - days * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');

  // FTS is a date-ordered feed with `next` cursor pagination; walk pages until
  // we have enough matches or hit a page cap (keeps it bounded when filtering).
  let url = `${FTS_BASE}?stages=${stage}&updatedFrom=${encodeURIComponent(from)}`;
  const out: Record<string, unknown>[] = [];
  let scanned = 0;
  for (let page = 0; page < 6 && out.length < limit; page++) {
    const res = await getJson(url);
    if (!res.ok) return { source: 'Find a Tender Service (UK)', error: res.error };
    const pkg = res.data as { releases?: Release[]; links?: { next?: string } };
    const releases = pkg.releases ?? [];
    scanned += releases.length;
    for (const r of releases) {
      if (out.length >= limit) break;
      if (keyword) {
        const hay = `${(r.tender?.title ?? '')} ${(r.tender?.description ?? '')}`.toLowerCase();
        if (!hay.includes(keyword)) continue;
      }
      out.push(compactRelease(r));
    }
    if (!pkg.links?.next || releases.length === 0) break;
    url = pkg.links.next;
  }
  return {
    source: 'Find a Tender Service — high-value UK government procurement (find-tender.service.gov.uk)',
    stage,
    days,
    keyword: keyword || undefined,
    scanned,
    count: out.length,
    note: keyword
      ? `Keyword "${keyword}" filtered client-side over the last ${days} days of FTS notices (the FTS feed has no server-side search). Widen days or drop the keyword for more.`
      : undefined,
    notices: out,
  };
}

async function findATenderNotice(args: Record<string, unknown>): Promise<unknown> {
  const ocid = String(args.ocid ?? args.id ?? '').trim();
  if (!ocid) return { error: 'find_a_tender_notice requires an "ocid" (e.g. "ocds-h6vhtk-06d27d") from find_a_tender_recent.' };
  const res = await getJson(`${FTS_BASE}/${encodeURIComponent(ocid)}`);
  if (!res.ok) return { source: 'Find a Tender Service (UK)', ocid, error: res.error === 'not found' ? `No FTS notice with OCID "${ocid}".` : res.error };
  const pkg = res.data as { releases?: Release[] };
  const r = pkg.releases?.[0];
  if (!r) return { source: 'Find a Tender Service (UK)', ocid, error: 'notice package had no release' };
  const tender = (r.tender ?? {}) as Record<string, any>;
  return {
    source: 'Find a Tender Service — high-value UK government procurement (find-tender.service.gov.uk)',
    ...compactRelease(r),
    cpv: tender.classification?.description ?? tender.classification?.id ?? null,
    category: tender.mainProcurementCategory ?? null,
    documents: Array.isArray(tender.documents)
      ? tender.documents.slice(0, 10).map((d: any) => ({ title: d.title ?? null, url: d.url ?? null }))
      : [],
  };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
