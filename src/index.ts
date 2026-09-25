interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Was this failure OUR OWN web service? — the other half of `internal-db-class.ts`.
 *
 * fleet #1089 pulled failures from our own Postgres out of `upstream_down` by
 * keying on the SQLSTATE inside PostgREST's four-key error envelope. That
 * covered the majority and structurally could not cover the rest: the rest
 * never reach Postgres, so they carry no SQLSTATE. What was left, measured over
 * the 24h to 2026-09-02T15:00Z (fleet #1096):
 *
 *     5  pipeworx-catalog  get_pack_tools     Pipeworx catalog error: 522 — error code: 522
 *     3  fleet             fleet_list_open …  upstream_down: Fleet task queue did not respond within 25s
 *
 * 521/522/523/526 are Cloudflare saying its edge could not reach an ORIGIN, and
 * in both of those rows the origin is ours — `gateway.pipeworx.io` for the
 * catalog pack (it self-fetches when the gateway hasn't injected a manifest),
 * our own Supabase for fleet. There is no third party anywhere in either call.
 * Same defect as #1089: our own outage filed under `upstream_down`, the one
 * class that means "the source is unreachable and there is nothing for us to
 * fix", which is why the problem-tools triage skips it.
 *
 * WHY NOT A WORDING RULE. The obvious fix is to match `fleet db error:` and
 * `Pipeworx catalog error:` in classifyToolError. Each is emitted from exactly
 * one site today, so it would work today. It would also rot the first time
 * somebody rewords a label — silently, and in the direction of hiding our own
 * outage, which is worse than the bug being fixed. Every prose rule in
 * error-class.ts has needed widening as packs invented new wording (#409/#450/
 * #584); that history is most of that file's comment budget.
 *
 * WHAT THIS KEYS ON INSTEAD: **the host the call actually reached.** A URL's
 * hostname is a fact about the call, not a guess about its prose. Two
 * consequences that a pack-level flag could not give us, and the reason the
 * flag was rejected:
 *
 *   - It describes the CALL, not the pack. `govcon-intel` fans out to our own
 *     Supabase AND to genuine third parties; `court-listener` holds our cache
 *     in Supabase and fetches courtlistener.com. An `internallyHosted: true` on
 *     either pack would relabel a real third-party outage as ours — inventing
 *     work, which is the same class of error in the opposite direction.
 *   - It covers every future internal pack for free, instead of one declared
 *     slug at a time.
 *
 * WHY IT SURVIVES A REWORD. The marker below is not matched as a literal by two
 * separate files. `markInternalOrigin()` writes it and `internalHostMetricsClass()`
 * reads it, both from the single exported `INTERNAL_ORIGIN_MARKER` constant in
 * this module — so changing the wording changes both sides in the same edit and
 * cannot desynchronise them. The pack's own label (`fleet db error:`,
 * `Pipeworx catalog error:`) is not read at all: reword it freely, the class is
 * unaffected. That is the property `stripClassPrefix` lacked when it drifted
 * from its own classifier three times and needed a CI gate to hold them
 * together.
 *
 * WHERE THE 5xx TEST LIVES. `markInternalOrigin` is called from the places that
 * hold the real `Response` — `httpError`/`httpErrorMessage` and the timeout
 * branch of `fetchWithTimeout` in `shared/src/http.ts` — so "is this an
 * availability failure" is decided from the actual status code, never re-derived
 * by scraping a number out of a sentence. A 404 from our own registry for a slug
 * that does not exist is a caller's bad argument and is deliberately NOT marked.
 */

/**
 * OUR OWN web service was unreachable — not an upstream, and never `upstream_down`.
 *
 * ONE value, not three, unlike `internal_db_*`. That split existed because a
 * slow query, an exhausted pool and an unknown SQLSTATE have different owners
 * and different fixes. Here there is only one story to tell — an origin we run
 * did not answer the edge — and one owner. A bucket with no distinct owner per
 * value is decoration; #724 is what happens when a class holds several
 * situations, and inventing sub-values ahead of a reason to act on them
 * differently is the same mistake with the sign flipped.
 *
 * METRICS ONLY, exactly like PLATFORM_KEY_ERROR_CLASS and the internal_db
 * values. `classifyToolError` still answers `upstream_down` for the retry and
 * hint paths, which only care whether retrying or a sibling tool might work —
 * and it might. Nothing a caller sees or is charged changes here.
 *
 * READ SIDE: this value is in BROKEN_TOOL_CLASSES, FAULT_CLASSES and
 * ALL_ERROR_CLASSES in `workers/registry-api/src/index.ts`. All three, or it
 * lands on no dashboard — fleet #721 is the warning, where the #719 split
 * worked on the write side and was invisible for weeks.
 */
const INTERNAL_SERVICE_UNREACHABLE_CLASS = 'internal_service_unreachable';

/**
 * The token that carries "this origin is ours" from the call site to the
 * classifier.
 *
 * Appended to the error message rather than attached to the Error object,
 * because the object does not survive the trip: 275 packs return `{ error:
 * string }` instead of throwing, the gateway reads `observedError` as a string,
 * and the fleet pack rebuilds its error from a captured status + body across a
 * retry loop. A property on an Error would be dropped by every one of those
 * paths and the class would work in tests and vanish in production.
 *
 * WORDING IS LOAD-BEARING, same rule as labelAge's note in authority.ts. This
 * string is appended to a pack's thrown Error message (shared/src/http.ts),
 * and a thrown Error's message is exactly what the gateway hands back to the
 * caller as `content[0].text` when nothing rewrites it (workers/gateway/src
 * catches the throw and sets `rawResult.message = stripClassPrefix(error)`,
 * which does not touch this suffix) — so the original wording,
 * " [pipeworx-hosted origin — our own service, not a third party]", was not a
 * theoretical leak: it shipped live on pipeworx-catalog's 522s, 7 times in 6
 * hours on 2026-09-02 (see tests/golden-internal-service.test.ts), verbatim
 * naming Pipeworx as the host. check:hosting-claims never caught it because it
 * did not scan shared/ at all (task #2009). Reworded to describe the
 * OBSERVATION (the origin did not answer) without a claim about who runs it —
 * the identical fix labelAge got: drop the possessive, keep the fact.
 */
const INTERNAL_ORIGIN_MARKER = ' [origin did not respond — retry before concluding the named source is down]';

/**
 * Supabase's data plane for a project is `<ref>.supabase.co`, where the ref is
 * exactly twenty lowercase letters (ours is `pqauisounztsgdgfkhke`).
 *
 * Matching the shape rather than listing the ref keeps this correct when we add
 * a project — `supabaseEnv` on a pack entry already points some packs at a
 * second one — while still excluding `status.supabase.co`, which is Supabase's
 * own status page and emphatically not our database. Verified 2026-09-02 by
 * `grep -rhoE '[a-z0-9-]+\.supabase\.(co|in)' mcps shared workers scripts`: the
 * only real project ref anywhere in the tree is ours, the rest are doc
 * placeholders (`abc`, `xyz`, `example`) which this pattern also excludes. Same
 * finding internal-db-class.ts relies on for the PostgREST envelope being ours
 * by construction.
 */
const SUPABASE_PROJECT_HOST = /^[a-z]{20}\.supabase\.(co|in)$/;

/**
 * Is this a host WE run?
 *
 * Deliberately NOT including `*.workers.dev`: plenty of third-party APIs are
 * hosted on workers.dev, so the suffix says where something runs and not who
 * owns it. Every internal call we actually make goes to a `pipeworx.io`
 * hostname or to our Supabase project, both of which are ownership facts.
 *
 * `workers/gateway/src/provenance.ts`'s `OUR_HOSTS` answers the same
 * question and DOES include `workers.dev` — a documented divergence
 * (task #2051), not a bug to converge. That list decides what a response may
 * cite as a data SOURCE, where a false negative (citing our own worker as an
 * external source) is the hosting-disclosure leak this whole file exists to
 * prevent, so it errs broad. This one decides who gets BLAMED for a 5xx in
 * outage metrics read by on-call, where a false positive (crediting our own
 * infra with a third party's outage) hides the real failure, so it errs
 * narrow. Same suffix, opposite direction, because they are never called for
 * the same reason.
 *
 * Returns false on anything unparseable rather than throwing — this runs inside
 * an error path, and an error path that can itself throw turns a diagnosable
 * failure into a mystery.
 */
function isPipeworxOrigin(url: string | URL | undefined | null): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url instanceof URL ? url.href : url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'pipeworx.io' || host.endsWith('.pipeworx.io')) return true;
  return SUPABASE_PROJECT_HOST.test(host);
}

/**
 * Append the marker when this failure was OUR origin failing to answer.
 *
 * `status` is the HTTP status when there is one, and omitted for a timeout —
 * where there is no response at all, and "the origin did not answer" is the
 * whole observation. Statuses below 500 are left alone: a 404 from our own
 * registry for a slug that does not exist is the caller's argument, not our
 * outage, and marking it would put ordinary 404s on the incident dashboard.
 *
 * Idempotent, so a message that is wrapped and re-marked on the way up (the
 * fleet pack's retry loop re-throws through two layers) carries the marker once.
 */
function markInternalOrigin(
  message: string,
  url: string | URL | undefined | null,
  status?: number,
): string {
  if (status !== undefined && status < 500) return message;
  if (!isPipeworxOrigin(url)) return message;
  if (message.includes(INTERNAL_ORIGIN_MARKER)) return message;
  return message + INTERNAL_ORIGIN_MARKER;
}

/**
 * Which blob4 value a failure from our own web services books as, or undefined
 * if this is not one.
 *
 * Ordered AFTER `internalDbMetricsClass` at the call site: a PostgREST envelope
 * from our own Supabase is a strictly more specific statement about the same
 * row (which of our services, and why), and the two cannot disagree about
 * whether the failure is ours.
 */
function internalHostMetricsClass(error: string): string | undefined {
  return error.includes(INTERNAL_ORIGIN_MARKER) ? INTERNAL_SERVICE_UNREACHABLE_CLASS : undefined;
}


/**
 * One place to turn a failed `fetch` into an error a caller can act on.
 *
 * Nearly every pack was written the same way:
 *
 *     if (!res.ok) throw new Error(`Unsplash: ${res.status}`);
 *
 * which discards the response body — and the body is usually where the upstream
 * says what was actually wrong ("**symbol** not found: GBP", "parameter `year`
 * out of range", "unknown taxonomy id"). The caller gets a number, cannot
 * self-correct, and retries the same broken call. A 2026-07-31 sweep found this
 * shape in 481 of 1,400 packs, 47 of them PLATFORM-keyed.
 *
 * It also hides bugs one level down. Two of the first three packs audited had a
 * second defect that only existed because of this line: unsplash's rate-limit
 * branch sat BELOW a catch-all and was unreachable, and bea-gov parsed
 * `BEAAPI.Error.APIErrorDescription` below a `!res.ok` throw that made the
 * parsing dead code for every non-200.
 *
 * DELIBERATELY NOT A CLASSIFIER. It does not add `user_error:` /
 * `upstream_down:` prefixes. Those decide which tier a failure lands in, and the
 * `error` tier is what the daily problem-tools list is built from — it means
 * "Pipeworx has a defect". A 400 is genuinely ambiguous: often a caller's bad
 * argument, but sometimes a query WE built wrong (ted-eu comma-joined its CPV
 * values into something TED rejected, and that bug was found only because it sat
 * in `error`). Blanket-classifying 400s as caller mistakes would have hidden it.
 * A pack that KNOWS which it is should keep saying so explicitly; this helper is
 * for the 481 that say nothing at all.
 */

/** Longest upstream explanation we'll pass through. Enough for a real message,
 *  short enough that an HTML page or a stack trace can't swamp the error. */

const MAX_DETAIL = 300;

/**
 * Default bound for `fetchWithTimeout` when a pack doesn't state its own.
 *
 * 25s mirrors the number `epo-ops` landed on after measuring the real failure:
 * a degraded upstream that doesn't error, it just never answers, and a Worker
 * sits in `await fetch()` until ITS OWN execution budget kills the request —
 * which can take minutes, not seconds (epo_ops_search_patents measured 4-8
 * MINUTE hangs before this existed). 25s is short enough that a caller gets a
 * fast, actionable error instead of holding the connection, and long enough
 * that it doesn't false-trip on a merely-slow-but-alive upstream.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

/**
 * Read the body of a failed response and fold it into a throwable Error.
 *
 * Usage — note the `await`, which is the one thing that makes this a mechanical
 * change rather than a drop-in:
 *
 *     if (!res.ok) throw await httpError(res, 'Unsplash');
 *
 * Safe to call on any non-ok response: a body that is missing, empty, unreadable
 * or HTML degrades to exactly the old `Name: 404` string rather than throwing
 * something new from inside the error path.
 */
async function httpError(res: Response, name: string): Promise<Error> {
  return new Error(await httpErrorMessage(res, name));
}

/** The message text without constructing an Error — for packs that need to wrap
 *  it in their own envelope or add an explicit classification prefix. */
async function httpErrorMessage(res: Response, name: string): Promise<string> {
  // The one place a 5xx from a host WE run gets stamped as ours. `res.url` is
  // the URL the fetch actually resolved to (after redirects), so this is a fact
  // about the call rather than a guess from the `name` the pack passed in —
  // reword that label freely, the class does not move. See
  // internal-host-class.ts; no-op for every third-party upstream, which is why
  // this touches 481 packs' error text and changes none of it.
  return markInternalOrigin(
    `${name}: ${res.status}${detailSuffix(await readDetail(res))}`,
    res.url,
    res.status,
  );
}

/**
 * Just the upstream's own explanation — no name, no status.
 *
 * For a pack that has already said both in its own sentence. epo-ops reads
 * `EPO rejected this search as too large (HTTP 413) — ${httpErrorMessage(…)}`,
 * which rendered as `… (HTTP 413) — EPO: 413.` once the XML detail was being
 * dropped: the upstream named twice, the status twice, and the one thing EPO
 * actually said ("Not enough characters before truncation character") nowhere
 * (fleet #712). Returns '' when the body carries nothing readable, so a caller
 * can fall back to its own wording.
 */
async function upstreamDetail(res: Response): Promise<string> {
  return readDetail(res);
}

/**
 * Read a SUCCESSFUL response as JSON, failing loudly when it isn't JSON.
 *
 * `httpError` above only ever runs on `!res.ok`, which leaves the nastier half
 * of the problem unhandled: an upstream that answers **HTTP 200 with an HTML
 * page**. A bot wall, a login redirect, a maintenance interstitial and a CDN
 * error page are all 200s, so `res.ok` is true, and `res.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * That string is the problem. It names no upstream, carries no status, and
 * reads like a parser bug in Pipeworx — so it lands in the `error` tier, which
 * means "we have a defect", and the caller is told nothing they can act on.
 * data.govt.nz sat dead behind an Imperva challenge this way and every
 * status-code health check we own reported it green (7889a845). A zero-length
 * body has the same shape: `Unexpected end of JSON input`, seen this week on
 * uk-gazette (83% of external calls) and census.
 *
 * UNLIKE `httpError`, this one DOES classify, and the asymmetry is deliberate.
 * A 400 is genuinely ambiguous — often the caller's bad argument, sometimes a
 * query we built wrong — so blanket-classifying it would hide our own bugs.
 * There is no such ambiguity here: **no argument a caller can pass makes a JSON
 * API return an HTML page.** It is always the upstream, so `upstream_down:` is
 * a statement of fact rather than a guess, and it keeps these out of the
 * problem-tools list where they crowd out real defects.
 *
 *     const data = await parseJson<Feed>(res, 'UK Gazette');
 *
 * Call it only after the `!res.ok` check — on a failed response you want
 * `httpError`, which mines the body for the upstream's own explanation.
 */
async function parseJson<T>(res: Response, name: string): Promise<T> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    throw new Error(
      `upstream_down: ${name} returned a body that could not be read (HTTP ${res.status}). ` +
        'The connection most likely dropped mid-response; retrying is reasonable.',
    );
  }

  const type = res.headers.get('content-type') ?? 'no content-type';

  if (!raw.trim()) {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with an EMPTY body where JSON was expected (${type}). ` +
        'Nothing about the request can cause this — it is an upstream fault, and the same call may well work on retry.',
    );
  }

  // Checked before parsing rather than in the catch, because knowing it is
  // markup is what turns "we failed to parse something" into "they served a
  // web page" — the second is diagnosable, the first is not.
  const head = raw.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    const kind = head.startsWith('<?xml') ? 'an XML document' : 'an HTML page';
    // The summary, not the source. Pasting the first 120 characters of a web
    // page handed the agent `<!DOCTYPE html><html lang="en"…` — the same leak
    // this branch exists to describe (fleet #712).
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with ${kind} instead of JSON (${type}). ` +
        'That is typically a bot wall, a login redirect or a maintenance page — it is returned as a SUCCESS, ' +
        `so status-code health checks read it as fine. No argument change will get past it. ` +
        `The page says: ${summarizeErrorBody(raw) || 'nothing readable'}`,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with a body that is not valid JSON (${type}). ` +
        `It begins: ${stripMarkup(raw).slice(0, 120) || '(unreadable)'}`,
    );
  }
}

/**
 * `fetch`, but bounded — the fix for a systemic gap found 2026-08-30: a grep
 * audit of every pack's `mcps/*\/src/index.ts` found 1,339 of ~1,500 call
 * `fetch()` with NO timeout guard anywhere in the file. Two of those
 * (epo-ops, statcan) were confirmed live-hanging for 4-8 minutes before this
 * existed — every unguarded call carries the same risk, just unconfirmed.
 *
 * Mirrors the `epoFetch` wrapper `mcps/epo-ops/src/index.ts` shipped first:
 * bound the request with `AbortSignal.timeout`, and on a timeout/abort throw
 * an `upstream_down:` error that names the upstream and the bound rather than
 * letting the raw `TimeoutError`/`AbortError` (which names neither) propagate.
 * `upstream_down:` is deliberate, same reasoning as `parseJson` above — no
 * argument a caller passes can make an upstream hang, so it is always the
 * upstream's fault, and marking it that way keeps a slow API off the
 * problem-tools list where it would crowd out our own defects.
 *
 * Usage — a mechanical swap for a bare `fetch(url, init)`:
 *
 *     const res = await fetchWithTimeout(url, init, 'Some API');
 *
 * Pass `timeoutMs` as a fourth argument to override the default for a pack
 * with a known-slower upstream; the label should be the same short name you'd
 * pass to `httpError`/`httpErrorMessage` for that call.
 */
async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  name: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      // States the OBSERVATION (no response in N seconds), not a diagnosis.
      // "appears to be degraded" is an inference about the vendor that we have
      // not checked, and it is wrong in a way that misdirects whoever reads it:
      // a timeout from a Worker can equally mean OUR egress is blocked.
      //
      // Measured today (2026-09-01, fleet #1047): every call to
      // mainnet.base.org failed from the x402 facilitator while the identical
      // request from a laptop returned 200. Base was entirely healthy; the
      // public RPC refuses Cloudflare Worker egress. Had this message fired
      // there it would have blamed Base by name, and the next person would have
      // waited for a vendor outage to clear that did not exist.
      // A timeout has no status to test — there is no response at all — so
      // `markInternalOrigin` is called without one: an origin we run that never
      // answered is an availability failure by definition. This is the half of
      // fleet #1096 with neither a SQLSTATE nor a status code to key on.
      throw new Error(
        markInternalOrigin(
          `upstream_down: ${name} did not respond within ${timeoutMs / 1000}s. ` +
            `That can be ${name} being slow or down, or this environment being unable to reach it ` +
            `(some hosts refuse datacenter/Worker egress) — retry shortly, and check reachability ` +
            `from elsewhere before concluding ${name} is down.`,
          url,
        ),
      );
    }
    throw err;
  }
}

function detailSuffix(detail: string): string {
  return detail ? ` — ${detail}` : '';
}

async function readDetail(res: Response): Promise<string> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    // Body already consumed, or the connection died mid-read. The status alone
    // is still worth throwing — never let the error path throw its own error.
    return '';
  }
  return summarizeErrorBody(raw);
}

/**
 * Turn ANY error body — JSON, HTML, XML or plain text — into one short phrase
 * that never contains markup.
 *
 * This used to just drop an HTML or XML body on the floor, on the reasoning
 * that markup crowds out the status. That was half right. Dropping it loses the
 * one sentence a caller could have acted on: an `Access Denied` title, an SDMX
 * `<message:Error>` text, an OPS fault string. A 2026-08-30 support sweep
 * measured 13 of 291 caller-facing error rows carrying a raw page or document
 * verbatim, across 11 packs, and in every one of them the useful content —
 * "Access Denied", "Invalid country code", "SCRAPE_TIMEOUT" — was in there,
 * buried in markup the agent had to parse out of a string (fleet #712).
 *
 * So: extract the meaning, discard the markup. The output is passed through
 * `stripMarkup` unconditionally, which is what lets `check:error-body-leak`
 * assert mechanically that no caller-facing message can contain `<?xml`,
 * `<!DOCTYPE` or `<html`.
 */
function summarizeErrorBody(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const head = raw.slice(0, 400).trimStart().toLowerCase();

  // An HTML error page (Cloudflare interstitial, nginx default, a login
  // redirect) says what it is in its <title>, and almost nowhere else.
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    const title = htmlTitle(raw);
    return title
      ? `${title} (upstream returned an HTML error page, not an API response)`
      : 'upstream returned an HTML error page, not an API response';
  }

  // XML fault documents — EPO OPS, SDMX (`<message:Error>`), SOAP faults. The
  // human sentence sits in a child element whose tag name says what it is.
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    const fault = xmlFaultText(raw);
    return fault
      ? `${stripMarkup(fault).slice(0, MAX_DETAIL)} (from the upstream's XML error document)`
      : 'upstream returned an XML error document with no readable message';
  }

  // Most JSON error bodies bury one human sentence among ids and echoed request
  // params. Prefer that sentence; fall back to the whole body when the shape is
  // unfamiliar, since an unfamiliar shape is exactly when we can least afford to
  // guess wrong and show nothing.
  const fromJson = messageFromJson(raw);
  return stripMarkup(fromJson ?? raw).slice(0, MAX_DETAIL);
}

/** The `<title>` of an HTML error page, or its first `<h1>` — the two places a
 *  bot wall, a 502 and an "Access Denied" all state what happened. */
function htmlTitle(raw: string): string | null {
  const head = raw.slice(0, 4000);
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) {
    const m = re.exec(head);
    const text = m ? stripMarkup(m[1]) : '';
    if (text) return text.slice(0, 160);
  }
  return null;
}

/** Tag names that carry the explanation in an XML fault document, namespace
 *  prefix optional (`<message:Error>`, `<com:Text>`, `<faultstring>`). */
const XML_FAULT_TAG_RE =
  /<(?:[A-Za-z0-9_.-]+:)?(?:text|message|description|faultstring|reason|detail|title|errormessage|error)\b[^>]*>([^<]{2,400})</i;

function xmlFaultText(raw: string): string | null {
  const head = raw.slice(0, 8000);
  const tagged = XML_FAULT_TAG_RE.exec(head);
  if (tagged && tagged[1].trim()) return tagged[1];

  // Nothing conventionally named — take the longest text node instead. A fault
  // document with one sentence in an oddly named element is still readable;
  // returning nothing at all is not.
  let best = '';
  for (const m of head.matchAll(/>([^<>]{8,400})</g)) {
    const text = m[1].trim();
    if (text.length > best.length) best = text;
  }
  return best || null;
}

/**
 * Remove every tag and stray angle bracket, then collapse whitespace.
 *
 * Applied to everything on the way out, including the JSON and plain-text
 * paths, because an upstream is free to embed markup in a JSON string field —
 * and a leak is a leak regardless of which branch produced it.
 */
function stripMarkup(s: string): string {
  return collapse(decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/[<>]/g, ' '));
}

/** The handful of entities that show up in error-page titles. Decoded AFTER
 *  tags are stripped and BEFORE the angle-bracket sweep, so `&lt;script&gt;`
 *  in a title cannot decode into markup that survives — EMBL-EBI's ChEMBL 500
 *  page renders as `500 Internal Server Error &lt; EMBL-EBI` otherwise. */
function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|#0*38);/gi, '&')
    .replace(/&(?:lt|#0*60);/gi, '<')
    .replace(/&(?:gt|#0*62);/gi, '>')
    .replace(/&(?:quot|#0*34);/gi, '"')
    .replace(/&(?:#0*39|apos|#x0*27);/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** The conventional "what went wrong" field, under any of the names upstreams
 *  actually use. Checked in order; first non-empty string wins. */
const MESSAGE_KEYS = [
  'message', 'error_message', 'errorMessage', 'detail', 'details',
  'description', 'error_description', 'reason', 'title', 'fault',
];

function messageFromJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return pickMessage(parsed, 0);
}

function pickMessage(node: unknown, depth: number): string | null {
  // Two levels covers `{error: {message}}` and `{errors: [{detail}]}`, the two
  // shapes that account for nearly all of them, without walking a large payload.
  if (depth > 2 || node == null) return null;

  if (typeof node === 'string') return node.trim() || null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  for (const key of MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // `{error: …}` where error is itself an object or a string — the single most
  // common wrapper, so it is worth descending into by name rather than scanning
  // every key and risking picking up an echoed request parameter.
  for (const key of ['error', 'errors', 'fault', 'Error', 'data']) {
    if (key in obj) {
      const found = pickMessage(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Errors are read in a single line of log output; newlines and runs of
 *  whitespace make a multi-line body unreadable there. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
/**
 * UK Contracts Finder MCP.
 *
 * UK government procurement notices — open tenders and awarded contracts —
 * published as OCDS (Open Contracting Data Standard) by the Cabinet Office.
 * Keyless. The natural UK complement to the EU tenders (ted-eu) pack.
 *
 * Data source: https://www.contractsfinder.service.gov.uk.
 *
 * TWO APIS, AND THE SEARCH ONE IS NOT THE OCDS ONE (fleet #607).
 *
 * The OCDS endpoint (/Published/Notices/OCDS/Search) is a date-ordered FEED. It
 * has no text search, and — this is the part that cost us — it does not reject a
 * keyword parameter either. `?keyword=MRI` returns HTTP 200 and the identical
 * release ids as the same call without it. Verified by comparing ids.
 *
 * This pack used to paper over that by fetching 100 recent notices and grepping
 * them client-side, which meant EVERY keyword returned zero: "MRI" over a
 * 20-month window, "scanner" over three months, all count 0. It read as "the NHS
 * has not procured an MRI scanner in 20 months", which is false and, from the
 * response alone, unfalsifiable. Contracts Finder has 655 MRI notices.
 *
 * The real search is a POST to /api/rest/2/search_notices/json with a
 * `searchCriteria` object, and it does proper server-side text search over
 * title, description and supplier. Detail for a search hit comes from
 * /api/rest/2/get_published_notice/json/{id}.
 *
 * MIND THE TWO ID SPACES. A search hit's `id` is NOT an OCDS release id and
 * 404s against /Published/OCDS/Release/{id}; the reverse is also true. get_notice
 * therefore tries both, in the order that matches whichever tool produced the id.
 *
 * AND MIND THE SILENT CRITERION. searchCriteria ignores anything it does not
 * recognise, returning the UNFILTERED corpus with a 200. `{keywords:['MRI']}`
 * (plural) and a bare top-level `{keyword:'MRI'}` both return hitCount 609,595 —
 * every notice ever published — while `{searchCriteria:{keyword:'MRI'}}` returns
 * 655. A typo here does not fail; it silently answers a different question with a
 * much bigger number, which is the more dangerous direction.
 */


// Bound every fetch() in this pack to a fixed timeout — an upstream that
// degrades without erroring would otherwise hold the Worker in `await fetch()`
// until its own execution budget kills the request (minutes, not seconds).
// Mirrors the epoFetch / usaspending retryFetch pattern (fleet #685).
async function pwFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return fetchWithTimeout(url, init ?? {}, 'UK Contracts');
}


const BASE = 'https://www.contractsfinder.service.gov.uk';
// Find a Tender Service (FTS) — the UK's HIGH-VALUE / above-threshold tender
// portal (post-Brexit replacement for EU TED). Same OCDS format as Contracts
// Finder, keyless, but a date-ordered FEED (no server-side keyword search).
const FTS_BASE = 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages';
const UA = 'pipeworx/1.0 (+https://pipeworx.io)';
// FTS rate-limits at 12 requests per 120 SECONDS — measured, and it answers in
// PLAIN TEXT ("Rate limit of 12 exceeded. Please retry after 120 seconds."), not
// JSON, so anything that assumes a JSON body throws rather than reporting a
// limit. 8 pages is two thirds of that budget for a single tool call, which is
// why the walk is bounded and why the bound is REPORTED rather than hidden.
const MAX_FTS_PAGES = 8;
const FTS_SOURCE =
  'Find a Tender Service — high-value UK government procurement (find-tender.service.gov.uk)';
// The REAL search: POST, `searchCriteria`, server-side text index. Not the OCDS
// feed, which accepts a keyword parameter and ignores it. See the header.
const SEARCH_URL = `${BASE}/api/rest/2/search_notices/json`;
const NOTICE_URL = `${BASE}/api/rest/2/get_published_notice/json`;

const tools: McpToolExport['tools'] = [
  {
    name: 'search_notices',
    description:
      'Full-text search of UK government procurement from Contracts Finder (Cabinet Office) — what the public sector bought, who supplied it, and for how much, plus open opportunities still out to tender. Covers NHS trusts, councils, police forces, universities and central government departments. Search by keyword ("MRI scanner", "agency nursing", "school catering", "cloud hosting") across notice title, description and awarded supplier, and narrow by publication date. Returns awarded contracts with supplier name and contract value by default, because a question about "contracts" usually means what was actually awarded. Keyless. The UK complement to EU tenders.',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description:
            'Free-text search over notice title, description and awarded supplier name, e.g. "MRI", "magnetic resonance imaging", "agency nursing". Server-side and properly indexed. Omit to browse the newest notices for the chosen status.',
        },
        status: {
          type: 'string',
          enum: ['awarded', 'open', 'closed', 'withdrawn', 'any'],
          description:
            'Which notices: "awarded" (contracts actually awarded, with supplier and value — the DEFAULT, and what a question about "contracts" nearly always means), "open" (opportunities still accepting bids), "closed" (bidding shut, award not yet published), "withdrawn", or "any". A niche keyword often has zero OPEN notices while having hundreds of awarded ones — "MRI" is 0 open, 151 closed, 495 awarded, 9 withdrawn — so an empty "open" result says nothing about whether the buying happened.',
        },
        notice_type: {
          type: 'string',
          enum: ['Contract', 'PreProcurement', 'Pipeline', 'Planning', 'Future'],
          description:
            'Optional notice type. "Contract" is a real procurement; "PreProcurement" is market engagement; "Pipeline"/"Planning"/"Future" are intentions to buy later.',
        },
        published_from: {
          type: 'string',
          description: 'Optional ISO date (YYYY-MM-DD) lower bound on publication date, e.g. "2025-01-01".',
        },
        published_to: {
          type: 'string',
          description: 'Optional ISO date (YYYY-MM-DD) upper bound on publication date, e.g. "2026-08-01".',
        },
        limit: {
          type: 'number',
          description: 'Max notices to return, 1–100 (default 20). `total_matches` reports the full hit count regardless.',
        },
      },
    },
  },
  {
    name: 'get_notice',
    description:
      'Get the full detail for a single UK Contracts Finder notice by the `id` returned by search_notices or recent_notices. Returns the complete (untruncated) description, buyer, contract value, awarded supplier, CPV classification, region, tender period and contact where published. Accepts either id form — search_notices returns a bare GUID and recent_notices an OCDS release id ("{guid}-{seq}"); they are separate id spaces on separate endpoints, and this tool routes to the right one for you. Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description:
            'The `id` from a search_notices result (a bare GUID, e.g. "5295555c-7556-4726-bd59-7895f51a3c3a") or from recent_notices (an OCDS release id, e.g. "a42239ac-faef-4245-ad0f-16b3a787675b-901561"). Either works.',
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
      'Recent HIGH-VALUE UK government tenders and contract awards from the Find a Tender Service (find-tender.service.gov.uk) — the UK\'s above-threshold procurement portal (the post-Brexit replacement for EU TED, for larger public contracts). Use for "high value UK tenders", "above threshold UK government contracts", "Find a Tender notices", "large UK public sector contract opportunities". Returns recent notices newest-first. An optional keyword is matched over title, description, award title and AWARDED SUPPLIER — client-side, because the FTS API has no text search (it rejects a keyword parameter outright, allowing only stages/limit/cursor/updatedFrom/updatedTo). ALWAYS READ `window_complete`: false means the walk stopped at the page cap with more feed left, so a zero means "absent from the notices examined", not "not published" — narrow `days` until it is true. For a proper full-corpus keyword SEARCH of UK procurement, and for lower-value notices, use search_notices (Contracts Finder), which does have a real server-side index. Keyless.',
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
    // Numeric entities generally, not a hand-list. Contracts Finder emits the
    // ZERO-PADDED form — "King&#039;s College Trust", "Naomi O&#039;Malley" —
    // which a literal `&#39;` rule misses by one character, so buyer names came
    // back with the escape still in them.
    .replace(/&#(\d+);/g, (_, d) => {
      const n = Number(d);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const n = parseInt(h, 16);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    // &amp; LAST, so "&amp;lt;" does not become a literal "<".
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n).trimEnd()}…` : s;
}

async function getJson(url: string): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const res = await pwFetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (res.status === 404) return { ok: false, error: 'not found' };
  if (!res.ok) return { ok: false, error: `${res.status} ${(await res.text()).slice(0, 200)}` };
  // Parse defensively rather than trusting a 2xx to be JSON. FTS answers its
  // rate limit ("Rate limit of 12 exceeded. Please retry after 120 seconds.")
  // as PLAIN TEXT, so res.json() throws a SyntaxError that surfaces as an
  // unhandled crash with no hint that a limit was the cause. Returning the body
  // means the caller is told what actually happened.
  const body = await res.text();
  try {
    return { ok: true, data: JSON.parse(body) };
  } catch {
    return { ok: false, error: `upstream returned non-JSON (${res.status}): ${body.slice(0, 200)}` };
  }
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

/** Search-API notice → the compact shape this pack returns everywhere. */
function compactNotice(item: Record<string, any>): Record<string, unknown> {
  const awarded = item.awardedSupplier || item.awardedValue != null || item.awardedDate;
  return {
    id: item.id ?? null,
    notice_identifier: item.noticeIdentifier ?? null,
    title: stripHtml(item.title),
    buyer: stripHtml(item.organisationName),
    description: truncate(stripHtml(item.description), 300),
    // valueLow/valueHigh is the ADVERTISED range; awardedValue is what was
    // actually contracted. Kept apart on purpose — reporting an advertised
    // ceiling as spend is how a procurement number gets overstated.
    // 0 means "not quoted", not "worth nothing": a notice with a single figure
    // sets valueLow and leaves valueHigh at 0, so passing both through raw
    // renders a contract as a range running down to zero.
    value: item.valueLow || item.valueHigh
      ? { low: item.valueLow || null, high: item.valueHigh || null, currency: 'GBP' }
      : null,
    award: awarded
      ? {
          supplier: stripHtml(item.awardedSupplier) || null,
          value: item.awardedValue ?? null,
          currency: 'GBP',
          date: item.awardedDate ?? null,
        }
      : null,
    status: item.noticeStatus ?? null,
    notice_type: item.noticeType ?? null,
    cpv_description: stripHtml(item.cpvDescription) || null,
    region: stripHtml(item.regionText) || null,
    published_date: item.publishedDate ?? null,
    deadline: item.deadlineDate ?? null,
    url: item.id ? `${BASE}/Notice/${item.id}` : null,
  };
}

const STATUS_MAP: Record<string, string[] | null> = {
  awarded: ['Awarded'],
  open: ['Open'],
  closed: ['Closed'],
  withdrawn: ['Withdrawn'],
  any: null,
};

// The byStatus facet does NOT sum to hitCount: for "MRI" it reports
// Open 0 + Closed 151 + Awarded 495 = 646 against a hitCount of 655. The
// missing 9 are Withdrawn, which the facet omits and the total includes.
// Verified by querying each status individually. Do not "reconcile" the two
// numbers — they are both correct and they count different things.

async function searchNotices(args: Record<string, unknown>): Promise<unknown> {
  const limit = clampLimit(args.limit, 20);
  const keyword = typeof args.keyword === 'string' ? args.keyword.trim() : '';
  const publishedFrom = isoDate(args.published_from);
  const publishedTo = isoDate(args.published_to);
  const statusArg = typeof args.status === 'string' ? args.status.toLowerCase() : 'awarded';
  if (!(statusArg in STATUS_MAP)) {
    return { error: `unknown status "${statusArg}"; expected one of ${Object.keys(STATUS_MAP).join(', ')}` };
  }
  const statuses = STATUS_MAP[statusArg];
  const noticeType = typeof args.notice_type === 'string' ? args.notice_type.trim() : '';

  // Every key here is one the API actually recognises. An unrecognised key is
  // NOT an error to Contracts Finder — it is silently dropped and you get the
  // unfiltered corpus back with a 200, so this object is deliberately built from
  // a fixed set rather than by spreading caller input.
  const searchCriteria: Record<string, unknown> = {};
  if (keyword) searchCriteria.keyword = keyword;
  if (statuses) searchCriteria.statuses = statuses;
  if (noticeType) searchCriteria.types = [noticeType];
  if (publishedFrom) searchCriteria.publishedFrom = publishedFrom;
  if (publishedTo) searchCriteria.publishedTo = publishedTo;

  const res = await pwFetch(SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ searchCriteria, size: limit }),
  });
  if (!res.ok) return { error: `contractsfinder: ${res.status} ${(await res.text()).slice(0, 200)}` };

  const data = (await res.json()) as Record<string, any>;
  const list = Array.isArray(data.noticeList) ? data.noticeList : [];
  const notices = list.map((n: Record<string, any>) => compactNotice(n.item ?? n));

  const facet = (f: unknown) => {
    const items = (f as Record<string, any>)?.items;
    if (!Array.isArray(items)) return null;
    return Object.fromEntries(items.map((i: Record<string, any>) => [i.key, Number(i.value)]));
  };

  // A ZERO RESULT IS THE DANGEROUS ONE, so it is the one that gets explained.
  //
  // The facets the API returns are computed AFTER the status filter, so asking
  // for open MRI tenders reports Open:0 / Closed:0 / Awarded:0 — technically
  // true and useless, because it cannot distinguish "nobody is buying MRI
  // scanners" from "nobody is buying them RIGHT NOW, but 495 contracts were
  // awarded". That distinction is the whole of this bug (#607, and #346 before
  // it), so on an empty result we re-ask without the status/type narrowing and
  // report what actually exists. One extra request, only when it matters.
  let elsewhere: Record<string, number> | null = null;
  if (notices.length === 0 && keyword && (statuses || noticeType)) {
    const wide: Record<string, unknown> = { keyword };
    if (publishedFrom) wide.publishedFrom = publishedFrom;
    if (publishedTo) wide.publishedTo = publishedTo;
    const probe = await pwFetch(SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ searchCriteria: wide, size: 1 }),
    });
    if (probe.ok) {
      const pd = (await probe.json()) as Record<string, any>;
      elsewhere = facet(pd.byStatus);
    }
  }

  return {
    count: notices.length,
    // The full server-side hit count, not the page size. Without it a caller
    // reading `count: 20` cannot tell a 20-hit query from a 655-hit one.
    total_matches: data.hitCount ?? null,
    status: statusArg,
    ...(keyword ? { keyword } : {}),
    ...(noticeType ? { notice_type: noticeType } : {}),
    ...(publishedFrom ? { published_from: publishedFrom } : {}),
    ...(publishedTo ? { published_to: publishedTo } : {}),
    ...(elsewhere
      ? {
          note:
            `No notices matched with status="${statusArg}", but this keyword DOES appear under other statuses — ` +
            'see matches_under_other_statuses. Zero here means zero of that kind, not zero procurement.',
          matches_under_other_statuses: elsewhere,
        }
      : {}),
    by_status: facet(data.byStatus),
    by_type: facet(data.byType),
    notices,
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

/**
 * Detail for a SEARCH-API notice id.
 *
 * A search hit's `id` is a bare GUID in a different id space from the OCDS
 * release id (`{guid}-{seq}`) that recent_notices returns, and each 404s against
 * the other's endpoint. Rather than make the caller know which tool produced the
 * id, getNotice tries the right one first by shape and falls back.
 */
async function getSearchNotice(id: string): Promise<Record<string, unknown> | null> {
  const res = await pwFetch(`${NOTICE_URL}/${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Record<string, any>;
  const n = (data.notice ?? {}) as Record<string, any>;
  if (!n || typeof n !== 'object' || !n.id) return null;

  // The awards live at the TOP level of the response, as a sibling of `notice` —
  // NOT inside it, and under different names from the search result's flattened
  // awardedSupplier/awardedValue. Reading them off `notice` returns undefined
  // for every award, which looks exactly like an unawarded contract.
  const awards = (Array.isArray(data.awards) ? data.awards : []).map((a: Record<string, any>) => ({
    supplier: stripHtml(a.supplierName) || null,
    supplier_address: stripHtml(a.supplierAddress) || null,
    duns: a.dunsNumber || null,
    value: a.value ?? null,
    currency: 'GBP',
    awarded_date: a.awardedDate ?? null,
    start: a.startDate ?? null,
    end: a.endDate ?? null,
    awarded_to_sme: a.awardedToSME ?? null,
    procedure: a.awardedProcedureType || null,
  }));
  const c = (n.contactDetails ?? {}) as Record<string, any>;

  return {
    id: n.id ?? id,
    id_space: 'contracts_finder_notice',
    notice_identifier: n.identifier ?? null,
    title: stripHtml(n.title),
    buyer: stripHtml(n.organisationName) || stripHtml(data.organisation?.name),
    // Full text here, not the 300-char summary the search results carry — the
    // whole point of asking for one notice is the detail.
    description: stripHtml(n.description),
    status: n.status ?? null,
    notice_type: n.type ?? null,
    // valueHigh is 0 rather than null when a notice quotes a single figure, so a
    // naive {low, high} would report a contract as a range down to zero.
    value: n.valueLow || n.valueHigh
      ? { low: n.valueLow || null, high: n.valueHigh || null, currency: 'GBP' }
      : null,
    awards: awards.length ? awards : null,
    cpv_codes: n.cpvCodes ?? data.cpvCodes ?? null,
    cpv_description: stripHtml(n.cpvDescription) || null,
    region: stripHtml(n.region) || null,
    postcode: n.postcode || null,
    sector: n.sector ?? null,
    procedure_type: n.procedureType ?? null,
    is_framework: n.isFrameworkAgreement ?? null,
    suitable_for_sme: n.isSuitableForSme ?? null,
    published_date: n.publishedDate ?? null,
    deadline: n.deadlineDate ?? null,
    start: n.start ?? null,
    end: n.end ?? null,
    contact: c.name || c.email ? { name: stripHtml(c.name) || null, email: c.email ?? null } : null,
    url: `${BASE}/Notice/${n.id ?? id}`,
  };
}

async function getNotice(args: Record<string, unknown>): Promise<unknown> {
  const id = typeof args.id === 'string' ? args.id.trim() : '';
  if (!id) return { error: 'provide a notice id (the `id` field from search_notices / recent_notices)' };

  // An OCDS release id carries a trailing "-{digits}"; a search-API id is a bare
  // GUID. Try the likely one first, then the other — a caller holding an id from
  // either tool should not have to know which.
  const looksOcds = /-\d+$/.test(id);
  if (!looksOcds) {
    const hit = await getSearchNotice(id);
    if (hit) return hit;
  }

  const r = await getJson(`${BASE}/Published/OCDS/Release/${encodeURIComponent(id)}`);
  if (!r.ok) {
    if (looksOcds) {
      const hit = await getSearchNotice(id);
      if (hit) return hit;
    }
    return {
      error: r.error === 'not found'
        ? 'notice not found in either the OCDS release space or the Contracts Finder notice space'
        : r.error,
      id,
    };
  }

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

  // FTS is a date-ordered feed with `next` cursor pagination and NO text search,
  // so a keyword can only be matched client-side over pages we actually walk.
  // That makes "how much of the window did we really see" the only thing
  // standing between an honest zero and a false one (fleet #611).
  //
  // The cap cannot simply be raised: FTS rate-limits at 12 requests per 120
  // SECONDS (measured — it answers `Rate limit of 12 exceeded. Please retry
  // after 120 seconds.` in plain text, not JSON). Eight pages is already two
  // thirds of that budget for one tool call.
  let url = `${FTS_BASE}?stages=${stage}&updatedFrom=${encodeURIComponent(from)}`;
  const out: Record<string, unknown>[] = [];
  let scanned = 0;
  let pages = 0;
  // `exhausted` means the feed itself ended — we reached the true end of the
  // window. Anything else means we stopped early and a zero proves nothing.
  let exhausted = false;
  let hitLimit = false;
  for (; pages < MAX_FTS_PAGES; pages++) {
    const res = await getJson(url);
    if (!res.ok) {
      // A partial walk is still worth returning WITH its provenance — but never
      // silently. Returning only the error threw away everything scanned so
      // far; returning results without saying the walk broke would be worse.
      return {
        source: FTS_SOURCE,
        stage, days,
        keyword: keyword || undefined,
        scanned, pages_walked: pages,
        window_complete: false,
        count: out.length,
        error: res.error,
        note:
          `The walk stopped on an upstream error after ${scanned} notices. FTS rate-limits at 12 requests/120s. ` +
          'These results are partial and a zero here means nothing — retry in two minutes, or narrow `days`.',
        notices: out,
      };
    }
    const pkg = res.data as { releases?: Release[]; links?: { next?: string } };
    const releases = pkg.releases ?? [];
    scanned += releases.length;
    for (const r of releases) {
      if (out.length >= limit) { hitLimit = true; break; }
      if (keyword) {
        // Award-stage releases carry the subject on `tender`, and the SUPPLIER
        // only under awards[].suppliers[].name — searching title+description
        // alone cannot find "awarded to Siemens".
        const awards = Array.isArray(r.awards) ? r.awards : [];
        const supplierText = awards
          .flatMap((a: Record<string, any>) => (Array.isArray(a.suppliers) ? a.suppliers : []))
          .map((sup: Record<string, any>) => String(sup?.name ?? ''))
          .join(' ');
        const awardText = awards.map((a: Record<string, any>) => String(a?.title ?? '')).join(' ');
        const hay = `${r.tender?.title ?? ''} ${r.tender?.description ?? ''} ${awardText} ${supplierText}`.toLowerCase();
        if (!hay.includes(keyword)) continue;
      }
      out.push(compactRelease(r));
    }
    if (hitLimit) break;
    if (!pkg.links?.next || releases.length === 0) { exhausted = true; pages++; break; }
    url = pkg.links.next;
  }

  // A zero is only trustworthy if the whole window was examined. Stopping
  // because `limit` was reached is fine — we found things. Stopping at the page
  // cap with the feed still going is NOT.
  //
  // Measured 2026-08-28 with a complete paced walk of the 30-day window:
  //   stage=tender     183 notices,  2 pages  — fully scanned, a zero is real
  //   stage=planning    96 notices,  1 page   — fully scanned
  //   stage=award    1,046 notices, 11 pages  — the 8-page cap sees ~761 (73%)
  // So on awards over a wide window, "count: 0" meant "absent from the 73% we
  // looked at" while reading to the caller as "not published". That is the whole
  // of this bug, and the reason window_complete exists.
  const windowComplete = exhausted || hitLimit;

  return {
    source: FTS_SOURCE,
    stage,
    days,
    keyword: keyword || undefined,
    scanned,
    pages_walked: pages,
    // The single field that separates an honest zero from a false one.
    window_complete: windowComplete,
    count: out.length,
    note: !windowComplete
      ? `TRUNCATED: stopped at the ${MAX_FTS_PAGES}-page cap after examining ${scanned} notices, and the feed had more. ` +
        `This is NOT the full ${days}-day window${keyword ? `, so count ${out.length} for "${keyword}" is "not in the ${scanned} examined", NOT "not published"` : ''}. ` +
        'FTS rate-limits at 12 requests/120s so the walk is deliberately bounded — narrow `days` until window_complete is true.'
      : keyword
        ? `Examined all ${scanned} FTS notices in the last ${days} days and matched "${keyword}" client-side (FTS has no server-side text search — its API rejects a keyword parameter, listing stages/limit/cursor/updatedFrom/updatedTo as the only ones allowed). The window was fully scanned, so this count is authoritative for it.`
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
