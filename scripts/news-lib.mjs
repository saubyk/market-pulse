// Pure helpers behind scripts/news.mjs (SPEC §3.10): validating the
// editor's list of news sources, parsing an RSS 2.0 or Atom feed into
// plain items, and choosing the recent headlines the commentary model is
// given. No I/O, no network.

export const SOURCES_PATH = "news-sources.json";

// Only items published within this many hours of the run are kept. The
// chosen outlets publish a few pieces a day, some only a few a week, so
// a single day's window would often come back empty.
export const WINDOW_HOURS = 72;
// At most this many items per outlet, and overall, so one prolific feed
// can't crowd the others out and the prompt stays a few thousand tokens.
export const PER_SOURCE = 5;
export const MAX_ITEMS = 16;
// Summaries are cut to this many characters (at a word boundary).
export const SUMMARY_CHARS = 400;

// news-sources.json: { "sources": [{ "name": "...", "feed": "https://..." }] }.
// Throws on anything malformed, so a typo fails the step loudly rather
// than silently dropping an outlet.
export function parseSources(json) {
  const fail = (msg) => {
    throw new Error(`${SOURCES_PATH}: ${msg}`);
  };
  if (!json || !Array.isArray(json.sources)) fail('expected { "sources": [...] }');
  const names = new Set();
  return json.sources.map((s, i) => {
    if (!s || typeof s.name !== "string" || !s.name.trim()) fail(`source ${i + 1} has no "name"`);
    if (typeof s.feed !== "string" || !isHttpUrl(s.feed)) fail(`"${s.name}" needs an http(s) "feed" URL`);
    if (names.has(s.name)) fail(`duplicate source name "${s.name}"`);
    names.add(s.name);
    return { name: s.name.trim(), feed: s.feed };
  });
}

export function isHttpUrl(s) {
  return typeof s === "string" && /^https?:\/\/[^\s]+$/i.test(s);
}

// Parse an RSS 2.0 (<item>) or Atom (<entry>) document into
// [{ source, title, link, published, summary }], where `published` is
// epoch ms or null when the date is missing or unparseable. Tolerant:
// a regex reader over the handful of elements needed, not a general XML
// parser — anything it can't read is dropped, never thrown.
export function parseFeed(xml, source) {
  const items = [];
  const blocks = [
    ...matchAll(xml, /<item\b[^>]*>([\s\S]*?)<\/item>/gi),
    ...matchAll(xml, /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi),
  ];
  for (const block of blocks) {
    const title = clean(element(block, "title"));
    if (!title) continue;
    const link = feedLink(block);
    const date = element(block, "pubDate") ?? element(block, "published") ?? element(block, "updated") ?? element(block, "dc:date");
    const t = date ? Date.parse(text(date)) : NaN;
    const summary = truncate(
      stripBoilerplate(clean(element(block, "description") ?? element(block, "summary") ?? "")),
      SUMMARY_CHARS,
    );
    items.push({ source, title, link, published: Number.isFinite(t) ? t : null, summary });
  }
  return items;
}

// The headlines to give the model: items published in the WINDOW_HOURS
// before `now` (a little future skew is tolerated, undated items are
// dropped), one per link, newest first, at most PER_SOURCE per outlet
// and MAX_ITEMS overall.
export function selectHeadlines(items, now, opts = {}) {
  const windowMs = (opts.windowHours ?? WINDOW_HOURS) * 3_600_000;
  const perSource = opts.perSource ?? PER_SOURCE;
  const max = opts.max ?? MAX_ITEMS;
  const seen = new Set();
  const counts = new Map();
  const out = [];
  const recent = items
    .filter((it) => it.published != null && it.published > now - windowMs && it.published <= now + 3_600_000)
    .sort((a, b) => b.published - a.published);
  for (const it of recent) {
    const key = it.link || `${it.source}|${it.title}`;
    if (seen.has(key)) continue;
    const n = counts.get(it.source) ?? 0;
    if (n >= perSource) continue;
    seen.add(key);
    counts.set(it.source, n + 1);
    out.push(it);
    if (out.length >= max) break;
  }
  return out;
}

function matchAll(s, re) {
  return [...s.matchAll(re)].map((m) => m[1]);
}

// Inner content of the first <name ...>...</name> (or null). Names with a
// namespace prefix are matched literally.
function element(block, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = block.match(new RegExp(`<${esc}(?:\\s[^>]*)?>([\\s\\S]*?)</${esc}>`, "i"));
  return m ? m[1] : null;
}

// RSS puts the URL in <link>text</link>; Atom in <link href="..."/>,
// preferring rel="alternate" (or no rel) over enclosures and the like.
function feedLink(block) {
  const rss = element(block, "link");
  if (rss && isHttpUrl(text(rss).trim())) return text(rss).trim();
  for (const m of block.matchAll(/<link\b([^>]*?)\/?>/gi)) {
    const attrs = m[1];
    const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    const rel = attrs.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1];
    if (href && (!rel || rel === "alternate") && isHttpUrl(decodeEntities(href))) return decodeEntities(href);
  }
  return null;
}

// Unwrap CDATA and decode entities, without touching markup.
function text(s) {
  return decodeEntities(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
}

// Plain text: CDATA unwrapped, entities decoded (twice, since feeds
// often escape HTML that itself contains entities), tags removed,
// whitespace collapsed.
function clean(s) {
  if (s == null) return "";
  return decodeEntities(text(s).replace(/<[^>]*>/g, " "))
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

// WordPress feeds end every excerpt with "[…]" and "The post X appeared
// first on Y." — noise for the model.
function stripBoilerplate(s) {
  return s
    .replace(/\s*The post .* appeared first on .*$/i, "")
    .replace(/\s*\[(?:…|\.\.\.)\]\s*$/, "…")
    .trim();
}

function truncate(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const space = cut.lastIndexOf(" ");
  return (space > n * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "") + "…";
}
