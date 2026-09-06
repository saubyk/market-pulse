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

// Instruments with an exchange session, and the exchange-local hour at
// which that session is over for the day: 17:00 New York for the CME /
// ICE contracts and the dollar index, 15:00 Chicago for the CBOE yield
// indices. A day's bar is "settled" once that instant has passed, and the
// snapshot records settled bars only (SPEC §3.6). The FX pairs quote
// around the clock and BTC never stops, so they are not in this table.
export const SESSION_CLOSE_HOUR = {
  copper: 17,
  brent: 17,
  gold: 17,
  dxy: 17,
  tnx: 15,
  tyx: 15,
};
export const EXCHANGE_KEYS = new Set(Object.keys(SESSION_CLOSE_HOUR));

export function yahooChartUrl(symbol, range = "1y") {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
}

// Turns a Yahoo chart payload into the quote the snapshot records, as of
// the instant `asOf` (unix ms — the run time; injectable for tests).
//
// Exchange-traded keys: the close is the last *settled* daily bar's
// close — the bar whose session-end (SESSION_CLOSE_HOUR in the exchange's
// own zone, so US daylight time is handled) is at or before `asOf` — and
// `ts` is that session end. meta.regularMarketPrice is deliberately not
// used: after the futures reopen (22:00 UTC in summer, 23:00 in winter)
// it is a live print from the *next* session, and even in-window it is
// the last trade, which Yahoo revises overnight, whereas the bar close is
// the official settlement and matches the year of history the trend
// statistics run on. A run that lands at 05:00 UTC Tuesday therefore
// still records Monday's session, dated Monday (`date`).
//
// FX keys: the live quote as before (there is no settlement), dated by
// the quote's exchange-local calendar date.
//
// Every bar is dated by the exchange's local calendar date, not the UTC
// date of its timestamp — Yahoo stamps futures bars at local midnight
// (04:00/05:00 UTC) and FX bars at London midnight (23:00 UTC the day
// *before*). History timestamps are normalised so that utcDate() of them
// gives that local date.
//
// Applies the ^TNX/^TYX percent-vs-percent×10 heuristic from
// src/lib/fetchers.ts (SPEC §3.5). `prev` is the settled bar before the
// recorded one; meta.chartPreviousClose is never used (it is the close
// before the *requested range*). Returns null with no usable data.
export function parseYahooChart(key, data, asOf = Date.now()) {
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;
  if (typeof meta?.regularMarketPrice !== "number") return null;

  const divisor = YIELD_KEYS.has(key) && meta.regularMarketPrice > 20 ? 10 : 1;
  const tz = typeof meta.exchangeTimezoneName === "string" ? meta.exchangeTimezoneName : "UTC";
  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];

  // One bar per exchange-local date; a later duplicate wins.
  const byDate = new Map();
  for (let i = 0; i < closes.length; i++) {
    if (closes[i] == null || typeof timestamps[i] !== "number") continue;
    byDate.set(zonedDate(timestamps[i] * 1000, tz), closes[i] / divisor);
  }
  const bars = [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  if (EXCHANGE_KEYS.has(key)) {
    const hour = SESSION_CLOSE_HOUR[key];
    const settled = bars
      .map(([date, close]) => [zonedTime(date, hour, tz), close, date])
      .filter(([end]) => end <= asOf);
    if (settled.length === 0) return null;
    const [ts, close, date] = settled[settled.length - 1];
    return {
      close,
      prev: settled.length >= 2 ? settled[settled.length - 2][1] : null,
      ts,
      date,
      history: settled.map(([ms, c]) => [ms, c]),
    };
  }

  const ts = typeof meta.regularMarketTime === "number" ? meta.regularMarketTime * 1000 : null;
  const date = ts == null ? null : zonedDate(ts, tz);
  const history = bars.map(([d, c]) => [dateStartMs(d), c]);
  return {
    close: meta.regularMarketPrice / divisor,
    prev: previousClose(bars, date),
    ts,
    date,
    history,
  };
}

// Close of the last bar dated strictly before `date` (bars: sorted
// [date, close] pairs). With no date, the second-to-last bar.
function previousClose(bars, date) {
  if (date == null) return bars.length >= 2 ? bars[bars.length - 2][1] : null;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i][0] < date) return bars[i][1];
  }
  return null;
}

// The session the run describes: the latest settled date among the
// exchange-traded quotes, or null when none of them was fetched.
export function sessionDate(quotes) {
  let latest = null;
  for (const key of EXCHANGE_KEYS) {
    const d = quotes[key]?.date;
    if (typeof d === "string" && (latest == null || d > latest)) latest = d;
  }
  return latest;
}

// UTC calendar date of a timestamp, "YYYY-MM-DD".
export function utcDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// 00:00 UTC of a "YYYY-MM-DD" date, as unix ms.
export function dateStartMs(date) {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

// Calendar date of `ms` in an IANA time zone, "YYYY-MM-DD".
export function zonedDate(ms, tz) {
  const parts = partsFormatter(tz).formatToParts(new Date(ms));
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Unix ms of `hour`:00 on `date` in an IANA time zone. Resolved through
// the zone's offset at that instant, so daylight-time changes are handled
// without a table (transitions happen at 02:00 local, never at a session
// close, so one correction step is exact).
export function zonedTime(date, hour, tz) {
  const guess = dateStartMs(date) + hour * 3_600_000;
  return guess - zoneOffsetMs(guess, tz);
}

// Offset of `tz` from UTC at instant `ms`, in ms (positive east of UTC).
function zoneOffsetMs(ms, tz) {
  const parts = offsetFormatter(tz).formatToParts(new Date(ms));
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(name);
  if (!m) return 0; // plain "GMT"
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0)) * 60_000;
}

const formatters = new Map();
function partsFormatter(tz) {
  const k = `p:${tz}`;
  if (!formatters.has(k)) {
    formatters.set(
      k,
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }),
    );
  }
  return formatters.get(k);
}
function offsetFormatter(tz) {
  const k = `o:${tz}`;
  if (!formatters.has(k)) {
    formatters.set(
      k,
      new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }),
    );
  }
  return formatters.get(k);
}

// One line of public/data/snapshots.jsonl, describing the session
// `date` (from sessionDate(); falls back to the run's UTC date when no
// exchange quote was fetched). `quotes` maps each Yahoo key to a
// parseYahooChart result or null; `btc` is {spot, prev24h} with nulls for
// whatever failed. Failed keys are listed in `errors` so a partially-
// successful day is still recorded honestly rather than lost.
//
// An FX quote taken after the session date — a run that drifted past
// midnight in London — is replaced by that pair's bar on the session
// date, so every value on the line describes the same session.
export function buildRecord({ asOf, date, quotes, btc, errors = [] }) {
  const record = { date: date ?? utcDate(asOf), asOf };
  for (const key of YAHOO_KEYS) {
    const q = quotes[key];
    record[key] = q ? alignToSession(q, record.date) : null;
  }
  record.btc = {
    spot: btc?.spot ?? null,
    prev24h: btc?.prev24h ?? null,
  };
  if (errors.length) record.errors = [...errors].sort();
  return record;
}

function alignToSession(q, date) {
  if (q.date == null || q.date <= date || !q.history?.length) {
    return { close: q.close, prev: q.prev, ts: q.ts };
  }
  const cutoff = dateStartMs(date);
  const bars = q.history.filter(([ms]) => ms <= cutoff);
  if (bars.length === 0) return { close: q.close, prev: q.prev, ts: q.ts };
  const [ms, close] = bars[bars.length - 1];
  return { close, prev: bars.length >= 2 ? bars[bars.length - 2][1] : null, ts: ms };
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
