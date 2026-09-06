// Trend statistics for the daily commentary (SPEC §3.7). Pure functions
// over daily close series — no I/O, no network, no React — so every
// number the narrative is allowed to cite is computed here and covered
// by `npm test` (scripts/trends.test.mjs). scripts/stats.mjs is the CLI.
//
// A "series" is [[unix ms, close], ...] sorted ascending, at most one
// bar per UTC date. Horizons are calendar days looked up as "the last
// close at or before N days ago", so weekends and holidays never produce
// a missing comparison, only a slightly older one.

import { EXCHANGE_KEYS, YAHOO_KEYS, dateStartMs, utcDate } from "./snapshot-lib.mjs";

export const INSTRUMENT_KEYS = [...YAHOO_KEYS, "btc"];

// Instruments whose level is a percentage (yields): their day-to-day
// moves are reported in basis points as well as percent-of-level.
export const YIELD_KEYS = new Set(["tnx", "tyx"]);

// Instruments with an exchange session (defined with the snapshot's
// session table). FX pairs (jpy/cad/inr) quote 24/5 and print on Sunday
// evenings, and BTC never stops, so "did markets trade" is judged on
// these alone.
export { EXCHANGE_KEYS };

const DAY_MS = 86_400_000;
const HORIZONS = { w1: 7, m1: 30, m3: 91 };
const TRADING_DAYS_PER_YEAR = 252;

// ---------------------------------------------------------------------
// Series construction

// Daily series from the snapshot log for one key ("btc" uses spot).
// Records with a null/failed entry are skipped. Exchange-traded bars are
// dated by their own `ts` — the session end the snapshot settled them
// at, which is on the session date by construction. The 24-hour
// instruments (FX, BTC) have no session of their own and take the
// record's session date, so a line written by a run that drifted past
// midnight still reads as one day. Records without a date (none are
// written any more) fall back to the run time.
export function seriesFromSnapshots(records, key) {
  const out = [];
  for (const r of records) {
    const recordMs = typeof r.date === "string" ? dateStartMs(r.date) : r.asOf;
    if (key === "btc") {
      if (typeof r.btc?.spot === "number") out.push([recordMs, r.btc.spot]);
      continue;
    }
    const q = r[key];
    if (typeof q?.close !== "number") continue;
    const ms = EXCHANGE_KEYS.has(key) && typeof q.ts === "number" ? q.ts : recordMs;
    out.push([ms, q.close]);
  }
  return normalize(out);
}

// Bars dated after `date` (a "YYYY-MM-DD" session date) are dropped: the
// fetched history of a 24-hour instrument can already hold a live bar
// for the day *after* the session the pack describes.
export function cutAfter(series, date) {
  const cutoff = dateStartMs(date) + DAY_MS - 1;
  return series.filter((b) => b[0] <= cutoff);
}

// Merge two series by UTC date. Where both have a bar for the same date,
// `preferred` wins — the snapshot log is what we actually observed and
// committed; the fetched history only fills the dates we don't own yet.
export function mergeSeries(preferred, filler) {
  const byDate = new Map();
  for (const bar of filler ?? []) byDate.set(utcDate(bar[0]), bar);
  for (const bar of preferred ?? []) byDate.set(utcDate(bar[0]), bar);
  return normalize([...byDate.values()]);
}

// Sort ascending and collapse to one bar per UTC date (last one wins).
function normalize(bars) {
  const byDate = new Map();
  for (const bar of [...bars].sort((a, b) => a[0] - b[0])) {
    byDate.set(utcDate(bar[0]), bar);
  }
  return [...byDate.values()].sort((a, b) => a[0] - b[0]);
}

// ---------------------------------------------------------------------
// Lookups

// Last bar at or before `ms`, or null.
export function closeAtOrBefore(series, ms) {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i][0] <= ms) return series[i];
  }
  return null;
}

// Last bar dated on an earlier UTC day than the series' last bar.
function previousBar(series) {
  if (series.length < 2) return null;
  const lastDay = utcDate(series[series.length - 1][0]);
  for (let i = series.length - 2; i >= 0; i--) {
    if (utcDate(series[i][0]) < lastDay) return series[i];
  }
  return null;
}

// Close at the end of the previous calendar year: the last bar dated in
// that year, or — when history doesn't reach that far — null.
function priorYearEnd(series, lastMs) {
  const year = new Date(lastMs).getUTCFullYear();
  const cutoff = Date.UTC(year, 0, 1) - 1;
  return closeAtOrBefore(series, cutoff);
}

// ---------------------------------------------------------------------
// Statistics

function move(key, from, to) {
  if (from == null || to == null || from === 0) return null;
  const m = { abs: round(to - from, 6), pct: round(((to - from) / from) * 100, 3) };
  if (YIELD_KEYS.has(key)) m.bp = round((to - from) * 100, 2);
  return m;
}

// 52-week high/low and where the last close sits in that range (0 = at
// the low, 1 = at the high). Needs at least ~half a year of bars to be
// meaningful; returns null below 120 bars.
export function range52w(series) {
  if (series.length === 0) return null;
  const last = series[series.length - 1];
  const since = last[0] - 365 * DAY_MS;
  const window = series.filter((b) => b[0] >= since);
  if (window.length < 120) return null;
  let hi = -Infinity;
  let lo = Infinity;
  for (const [, c] of window) {
    if (c > hi) hi = c;
    if (c < lo) lo = c;
  }
  const pos = hi === lo ? 0.5 : (last[1] - lo) / (hi - lo);
  return { hi, lo, pos: round(pos, 3) };
}

// Annualized standard deviation of daily log returns over the last
// `window` bars, as a percentage. Null if there aren't enough bars.
export function realizedVol(series, window = 20) {
  if (series.length < window + 1) return null;
  const tail = series.slice(-(window + 1));
  const rets = [];
  for (let i = 1; i < tail.length; i++) {
    const a = tail[i - 1][1];
    const b = tail[i][1];
    if (a <= 0 || b <= 0) return null;
    rets.push(Math.log(b / a));
  }
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance =
    rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  return round(Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100, 3);
}

// Median of the rolling `window`-bar realized vol across the series, so
// today's vol can be read as "calm" or "choppy" relative to the
// instrument's own past year rather than some absolute threshold.
export function medianRollingVol(series, window = 20) {
  const vols = [];
  for (let end = window + 1; end <= series.length; end++) {
    const v = realizedVol(series.slice(0, end), window);
    if (v != null) vols.push(v);
  }
  if (vols.length < 20) return null;
  vols.sort((a, b) => a - b);
  const mid = Math.floor(vols.length / 2);
  return vols.length % 2 ? vols[mid] : round((vols[mid - 1] + vols[mid]) / 2, 3);
}

export function volRegime(ratio) {
  if (ratio == null) return null;
  if (ratio < 0.7) return "calm";
  if (ratio > 1.4) return "choppy";
  return "normal";
}

// Did this instrument print a bar dated on `asOf`'s UTC day? A "no" on a
// weekday means a holiday or a stale feed; the prompt uses it to avoid
// narrating movement that didn't happen.
export function tradedOn(series, asOf) {
  if (series.length === 0) return false;
  return utcDate(series[series.length - 1][0]) === utcDate(asOf);
}

// Full stats for one instrument.
export function instrumentStats(key, series, asOf) {
  if (series.length === 0) return null;
  const last = series[series.length - 1];
  const prev = previousBar(series);
  const out = {
    last: last[1],
    lastTs: last[0],
    tradedToday: tradedOn(series, asOf),
    d1: move(key, prev?.[1], last[1]),
  };
  for (const [name, days] of Object.entries(HORIZONS)) {
    const ref = closeAtOrBefore(series, last[0] - days * DAY_MS);
    out[name] = move(key, ref?.[1], last[1]);
  }
  out.ytd = move(key, priorYearEnd(series, last[0])?.[1], last[1]);
  out.range52w = range52w(series);
  const vol = realizedVol(series);
  const medVol = medianRollingVol(series);
  out.vol20 = vol;
  out.volMedian1y = medVol;
  out.volRatio = vol != null && medVol ? round(vol / medVol, 3) : null;
  out.volRegime = volRegime(out.volRatio);
  return out;
}

// ---------------------------------------------------------------------
// Cross-asset relationships

function lastAndAgo(series, days) {
  if (!series || series.length === 0) return [null, null];
  const last = series[series.length - 1];
  const ago = closeAtOrBefore(series, last[0] - days * DAY_MS);
  return [last[1], ago?.[1] ?? null];
}

// Ratio of two series on their common dates, as a series.
export function ratioSeries(num, den) {
  if (!num || !den) return [];
  const denByDate = new Map(den.map((b) => [utcDate(b[0]), b[1]]));
  const out = [];
  for (const [ms, v] of num) {
    const d = denByDate.get(utcDate(ms));
    if (d != null && d !== 0) out.push([ms, v / d]);
  }
  return out;
}

// Difference of two series on their common dates, as a series.
export function spreadSeries(a, b) {
  if (!a || !b) return [];
  const bByDate = new Map(b.map((bar) => [utcDate(bar[0]), bar[1]]));
  const out = [];
  for (const [ms, v] of a) {
    const w = bByDate.get(utcDate(ms));
    if (w != null) out.push([ms, v - w]);
  }
  return out;
}

export function crossAssetStats(series) {
  const out = {};

  // 30Y − 10Y in percentage points; rising = steepening.
  const curve = spreadSeries(series.tyx, series.tnx);
  if (curve.length) {
    const [now, ago] = lastAndAgo(curve, HORIZONS.m1);
    out.curve = {
      spread: round(now, 4),
      spread1mAgo: ago == null ? null : round(ago, 4),
      change1mBp: ago == null ? null : round((now - ago) * 100, 2),
      shape: ago == null ? null : now > ago ? "steepening" : now < ago ? "flattening" : "unchanged",
    };
  }

  // Ounces of gold one bitcoin buys. Rising = BTC outperforming gold.
  const btcGold = ratioSeries(series.btc, series.gold);
  if (btcGold.length) {
    const [now, ago] = lastAndAgo(btcGold, HORIZONS.m1);
    out.btcInGoldOz = {
      now: round(now, 3),
      m1: move("ratio", ago, now),
    };
  }

  // Copper/gold: a classic growth-vs-fear gauge (rising = growth bid).
  // Scaled ×1000 so it reads as ~1.4 rather than 0.0014.
  const cuAu = ratioSeries(series.copper, series.gold).map(([ms, v]) => [ms, v * 1000]);
  if (cuAu.length) {
    const [now, ago] = lastAndAgo(cuAu, HORIZONS.m1);
    out.copperGold = {
      now: round(now, 4),
      m1: move("ratio", ago, now),
    };
  }

  // How much of a dollar-priced move is just the dollar: DXY's own 1d /
  // 1w moves, listed next to the four USD-priced instruments' moves.
  if (series.dxy?.length) {
    const [d1, d1ago] = lastAndAgo(series.dxy, 1);
    const [w1, w1ago] = lastAndAgo(series.dxy, HORIZONS.w1);
    out.dollar = {
      d1: move("dxy", d1ago, d1),
      w1: move("dxy", w1ago, w1),
    };
  }

  return out;
}

// ---------------------------------------------------------------------
// The stats pack: everything the commentary model is given.

// `asOf`      — run time (unix ms)
// `date`      — the session the pack describes ("YYYY-MM-DD", from the
//               snapshot step); defaults to asOf's UTC date
// `histories` — {key: series} from Yahoo/CoinGecko (may be missing keys)
// `snapshots` — parsed snapshots.jsonl records (may be empty)
export function buildStatsPack({ asOf, date, histories = {}, snapshots = [] }) {
  date ??= utcDate(asOf);
  const dayEnd = dateStartMs(date) + DAY_MS - 1;
  const series = {};
  for (const key of INSTRUMENT_KEYS) {
    const own = seriesFromSnapshots(snapshots, key);
    const merged = cutAfter(mergeSeries(own, histories[key]), date);
    if (merged.length) series[key] = merged;
  }

  const instruments = {};
  for (const key of INSTRUMENT_KEYS) {
    instruments[key] = series[key] ? instrumentStats(key, series[key], dayEnd) : null;
  }

  return {
    date,
    asOf,
    // "Did markets trade on `date`" for the prompt — exchange-traded
    // instruments only (FX prints on Sunday evenings; BTC never stops).
    // With session dating this is true whenever an exchange bar exists
    // for the date; it stays for manual runs against an arbitrary date.
    tradingDay: [...EXCHANGE_KEYS].some((k) => instruments[k]?.tradedToday),
    barsPerInstrument: Object.fromEntries(
      INSTRUMENT_KEYS.map((k) => [k, series[k]?.length ?? 0]),
    ),
    instruments,
    cross: crossAssetStats(series),
  };
}

function round(n, dp) {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
