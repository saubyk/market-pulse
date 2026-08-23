// Pure helpers behind scripts/snapshot.mjs — no I/O, no network — so the
// record shape and the append/replace logic can be unit-tested with
// `npm test` (Node's built-in runner; see scripts/snapshot.test.mjs).
//
// This is the CI side of the daily-commentary feature (SPEC §3.6). It is
// deliberately separate from src/lib/fetchers.ts: the dashboard's own
// fetch path, history range and sparkline must not change.

// Same Yahoo symbols the dashboard uses (plus the two picker rates).
export const YAHOO_SYMBOLS = {
  copper: "HG=F",
  brent: "BZ=F",
  tnx: "^TNX",
  tyx: "^TYX",
  gold: "GC=F",
  jpy: "JPY=X",
  dxy: "DX-Y.NYB",
  cad: "CAD=X",
  inr: "INR=X",
};

export const YAHOO_KEYS = Object.keys(YAHOO_SYMBOLS);

const YIELD_KEYS = new Set(["tnx", "tyx"]);

export function yahooChartUrl(symbol, range = "1y") {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
}

// Applies the ^TNX/^TYX percent-vs-percent×10 heuristic from
// src/lib/fetchers.ts (SPEC §3.5): if the raw price is above any plausible
// yield, Yahoo is reporting ×10 and everything is rescaled.
//
// `prev` is the previous *trading day's* close, taken from the history
// itself: the last close on an earlier UTC day than the quote. Yahoo's
// meta.chartPreviousClose is deliberately not used — it is the close
// before the *requested range* began (a year ago for range=1y).
// Returns null when the payload has no usable price.
export function parseYahooChart(key, data) {
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;
  if (typeof meta?.regularMarketPrice !== "number") return null;

  const divisor = YIELD_KEYS.has(key) && meta.regularMarketPrice > 20 ? 10 : 1;
  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const ts = typeof meta.regularMarketTime === "number"
    ? meta.regularMarketTime * 1000
    : null;

  const history = [];
  for (let i = 0; i < closes.length; i++) {
    if (closes[i] == null || typeof timestamps[i] !== "number") continue;
    history.push([timestamps[i] * 1000, closes[i] / divisor]);
  }

  return {
    close: meta.regularMarketPrice / divisor,
    prev: previousDayClose(history, ts),
    ts,
    history, // [[unix ms, close], ...] — consumed by the commentary step
  };
}

// Last close in `history` dated on an earlier UTC day than `ts`. With no
// usable `ts`, fall back to the second-to-last bar.
export function previousDayClose(history, ts) {
  if (ts == null) {
    return history.length >= 2 ? history[history.length - 2][1] : null;
  }
  const day = utcDate(ts);
  for (let i = history.length - 1; i >= 0; i--) {
    if (utcDate(history[i][0]) < day) return history[i][1];
  }
  return null;
}

// UTC calendar date of a timestamp, "YYYY-MM-DD".
export function utcDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// One line of public/data/snapshots.jsonl. `quotes` maps each Yahoo key
// to a parseYahooChart result or null; `btc` is {spot, prev24h} with
// nulls for whatever failed. Failed keys are listed in `errors` so a
// partially-successful day is still recorded honestly rather than lost.
export function buildRecord({ asOf, quotes, btc, errors = [] }) {
  const record = { date: utcDate(asOf), asOf };
  for (const key of YAHOO_KEYS) {
    const q = quotes[key];
    record[key] = q ? { close: q.close, prev: q.prev, ts: q.ts } : null;
  }
  record.btc = {
    spot: btc?.spot ?? null,
    prev24h: btc?.prev24h ?? null,
  };
  if (errors.length) record.errors = [...errors].sort();
  return record;
}

// Insert `record` into the JSONL text, replacing an existing line with the
// same date (a re-run for the same day — manual catch-up, a retried job —
// must not produce duplicates). Lines stay sorted by date so the file
// reads as a time series. Always ends with a newline.
export function upsertRecord(text, record) {
  const lines = text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
  const kept = lines.filter((r) => r.date !== record.date);
  kept.push(record);
  kept.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return kept.map((r) => JSON.stringify(r)).join("\n") + "\n";
}
