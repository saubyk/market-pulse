#!/usr/bin/env node
// Fetches the editor's chosen news feeds (news-sources.json) and writes
// the recent headlines the commentary model is given (SPEC §3.10):
//
//   node scripts/news.mjs --out news.json   # what CI runs
//   node scripts/news.mjs                   # prints the pack instead
//
// Runs in CI between the stats and commentary steps. Each feed is tried
// directly first; if that fails and MP_PROXY_TOKEN is set, it is retried
// through the Cloudflare worker's token path (MP_PROXY_URL overrides the
// default worker, as in snapshot.mjs) — some outlets block GitHub's runner
// IPs. The worker relays only the feeds it lists (worker/index.js
// ALLOWED_FEEDS). A feed that fails
// (timeout, HTTP error, unreadable XML) is logged and skipped; the others
// still count, and with none at all the pack simply has no items — the
// note is then written without a geopolitics section. Only a malformed
// news-sources.json exits 1. Parsing and selection live in news-lib.mjs.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { SOURCES_PATH, parseFeed, parseSources, selectHeadlines } from "./news-lib.mjs";

const TIMEOUT_MS = 15_000;
const DEFAULT_WORKER = "https://market-pulse-proxy.suheb-khan.workers.dev/?url=";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const ACCEPT = "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5";

// Direct first, then the worker when a token is available.
function attempts(feed) {
  const list = [
    {
      label: "direct",
      url: feed,
      headers: { "User-Agent": "market-pulse-news/1.0 (+https://github.com/saubyk/market-pulse)", Accept: ACCEPT },
    },
  ];
  const token = process.env.MP_PROXY_TOKEN;
  if (token) {
    const worker = process.env.MP_PROXY_URL || DEFAULT_WORKER;
    list.push({ label: "worker", url: worker + encodeURIComponent(feed), headers: { "X-MP-Token": token, Accept: ACCEPT } });
  }
  return list;
}

async function fetchItems(source, a) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(a.url, { signal: ctrl.signal, headers: a.headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = parseFeed(await res.text(), source.name);
    if (items.length === 0) throw new Error("no items in feed");
    return items;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFeed(source) {
  const failures = [];
  for (const a of attempts(source.feed)) {
    try {
      return { items: await fetchItems(source, a), via: a.label };
    } catch (e) {
      failures.push(`${a.label}: ${e.message ?? e}`);
    }
  }
  throw new Error(failures.join("; "));
}

async function main() {
  const outPath = arg("--out");
  const sources = parseSources(JSON.parse(await readFile(SOURCES_PATH, "utf8")));
  const now = Date.now();

  const results = await Promise.allSettled(sources.map(fetchFeed));
  const all = [];
  const failed = [];
  results.forEach((r, i) => {
    const name = sources[i].name;
    if (r.status === "fulfilled") {
      console.log(`news: ${name} — ${r.value.items.length} items in feed (via ${r.value.via})`);
      all.push(...r.value.items);
    } else {
      console.log(`news: ${name} — FAILED (${r.reason?.message ?? r.reason})`);
      failed.push(name);
    }
  });

  const items = selectHeadlines(all, now);
  const pack = { fetchedAt: now, sources: sources.map((s) => s.name), failed, items };
  console.log(`news: ${items.length} headlines selected from ${sources.length - failed.length}/${sources.length} feeds`);

  if (outPath) {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify(pack, null, 2) + "\n");
  } else {
    console.log(JSON.stringify(pack, null, 2));
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
