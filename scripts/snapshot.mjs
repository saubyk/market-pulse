#!/usr/bin/env node
// Daily snapshot for the commentary pipeline (SPEC §3.6). Run by
// .github/workflows/daily-commentary.yml after the US close, or by hand:
//
//   node scripts/snapshot.mjs                 # appends today's record
//   node scripts/snapshot.mjs --history-out h.json   # also dump 1y closes
//   node scripts/stats.mjs --history h.json          # → stats pack (M2)
//
// Fetches a year of daily closes for the nine Yahoo symbols (seven tiles
// + the two currency-picker rates) plus BTC spot / 24h reference, and
// upserts one JSON line into public/data/snapshots.jsonl for the last
// *settled* exchange session — dated by that session, not by the clock,
// so a run that GitHub delays past midnight (or one on a weekend or a
// holiday) still describes the right day and never claims the next one.
// Re-running for the same session replaces that session's line.
//
// Yahoo is tried directly first (no CORS concern server-side). GitHub's
// runners are datacenter IPs Yahoo often blocks, so the second hop is our
// Cloudflare worker authenticated with the X-MP-Token header (env
// MP_PROXY_TOKEN; MP_PROXY_URL overrides the default worker), and the
// public proxies the dashboard also uses come last so forks without a
// worker still get data.
//
// Never touches the dashboard's fetch path — src/lib/fetchers.ts and the
// 30-day sparkline are unaffected by anything here.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  YAHOO_KEYS,
  YAHOO_SYMBOLS,
  buildRecord,
  parseYahooChart,
  sessionDate,
  upsertRecord,
  utcDate,
  yahooChartUrl,
} from "./snapshot-lib.mjs";

const SNAPSHOT_PATH = "public/data/snapshots.jsonl";
const ATTEMPT_TIMEOUT_MS = 10_000;
const STAGGER_MS = 400;
const DEFAULT_WORKER = "https://market-pulse-proxy.suheb-khan.workers.dev/?url=";
const PUBLIC_PROXIES = [
  "https://api.allorigins.win/raw?url=",
  "https://api.codetabs.com/v1/proxy?quest=",
];
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, headers = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ATTEMPT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Ordered list of {label, url, headers} attempts for one Yahoo target.
function yahooAttempts(target) {
  const encoded = encodeURIComponent(target);
  const attempts = [
    { label: "yahoo", url: target, headers: { "User-Agent": BROWSER_UA } },
  ];
  const token = process.env.MP_PROXY_TOKEN;
  if (token) {
    const worker = process.env.MP_PROXY_URL || DEFAULT_WORKER;
    attempts.push({
      label: "worker",
      url: worker + encoded,
      headers: { "X-MP-Token": token },
    });
  }
  for (const p of PUBLIC_PROXIES) {
    attempts.push({ label: new URL(p).host, url: p + encoded, headers: {} });
  }
  return attempts;
}

async function fetchYahoo(key, asOf) {
  const target = yahooChartUrl(YAHOO_SYMBOLS[key]);
  const failures = [];
  for (const a of yahooAttempts(target)) {
    try {
      const q = parseYahooChart(key, await getJson(a.url, a.headers), asOf);
      if (!q) throw new Error("empty/invalid result");
      return { quote: q, via: a.label };
    } catch (e) {
      failures.push(`${a.label}: ${e.message ?? e}`);
    }
  }
  throw new Error(failures.join("; "));
}

async function fetchBtc() {
  const btc = { spot: null, prev24h: null, history: [] };
  const errors = [];
  try {
    const d = await getJson("https://api.coinbase.com/v2/prices/BTC-USD/spot");
    const amount = parseFloat(d?.data?.amount);
    if (!Number.isFinite(amount)) throw new Error("bad amount");
    btc.spot = amount;
  } catch (e) {
    errors.push(`btc.spot: ${e.message ?? e}`);
  }
  try {
    const d = await getJson(
      "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=1",
    );
    const first = d?.prices?.[0]?.[1];
    if (typeof first !== "number") throw new Error("empty prices");
    btc.prev24h = first;
  } catch (e) {
    errors.push(`btc.prev24h: ${e.message ?? e}`);
  }
  // A year of daily closes for the trends step (not stored in the
  // snapshot record — the record keeps only spot/prev24h). Best-effort:
  // the snapshot log itself becomes BTC's history over time.
  try {
    const d = await getJson(
      "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365&interval=daily",
    );
    const prices = d?.prices ?? [];
    if (prices.length === 0) throw new Error("empty prices");
    btc.history = prices.filter((p) => typeof p?.[1] === "number");
  } catch (e) {
    errors.push(`btc.history: ${e.message ?? e}`);
  }
  return { btc, errors };
}

async function main() {
  const args = process.argv.slice(2);
  const histIdx = args.indexOf("--history-out");
  const historyOut = histIdx >= 0 ? args[histIdx + 1] : null;

  const asOf = Date.now();
  const quotes = {};
  const history = {};
  const errors = [];

  // Serial with a small gap, like the dashboard: the proxies rate-limit
  // bursts from one IP, and there is no hurry in a daily job.
  for (const key of YAHOO_KEYS) {
    try {
      const { quote, via } = await fetchYahoo(key, asOf);
      quotes[key] = quote;
      history[key] = quote.history;
      console.log(`${key.padEnd(7)} ${String(quote.close).padEnd(12)} ${quote.date ?? "-"} via ${via} (${quote.history.length} closes)`);
    } catch (e) {
      quotes[key] = null;
      errors.push(key);
      console.error(`${key.padEnd(7)} FAILED — ${e.message}`);
    }
    await delay(STAGGER_MS);
  }

  const { btc, errors: btcErrors } = await fetchBtc();
  history.btc = btc.history;
  console.log(`btc     spot ${btc.spot} prev24h ${btc.prev24h} (${btc.history.length} closes)`);
  for (const e of btcErrors) console.error(`btc     ${e}`);
  if (btc.spot == null) errors.push("btc");

  const gotAny = Object.values(quotes).some(Boolean) || btc.spot != null;
  if (!gotAny) {
    console.error("every source failed — not writing a record");
    process.exit(1);
  }

  // The session this run describes. With every exchange fetch failed
  // there is nothing to date it by, so fall back to the run's UTC date.
  const date = sessionDate(quotes) ?? utcDate(asOf);
  const record = buildRecord({ asOf, date, quotes, btc, errors });
  let existing = "";
  try {
    existing = await readFile(SNAPSHOT_PATH, "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  await mkdir(dirname(SNAPSHOT_PATH), { recursive: true });
  await writeFile(SNAPSHOT_PATH, upsertRecord(existing, record));
  console.log(
    `wrote session ${record.date} (run ${new Date(asOf).toISOString()}) to ${SNAPSHOT_PATH}${errors.length ? ` (errors: ${errors.join(", ")})` : ""}`,
  );

  if (historyOut) {
    await mkdir(dirname(historyOut), { recursive: true });
    await writeFile(historyOut, JSON.stringify({ asOf, date, history }));
    console.log(`wrote 1y history to ${historyOut}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
