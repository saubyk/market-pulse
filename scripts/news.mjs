#!/usr/bin/env node
// Fetches the editor's chosen news feeds (news-sources.json) and writes
// the recent headlines the commentary model is given (SPEC §3.10):
//
//   node scripts/news.mjs --out news.json   # what CI runs
//   node scripts/news.mjs                   # prints the pack instead
//
// Runs in CI between the stats and commentary steps. A feed that fails
// (timeout, HTTP error, unreadable XML) is logged and skipped; the others
// still count, and with none at all the pack simply has no items — the
// note is then written without a geopolitics section. Only a malformed
// news-sources.json exits 1. Parsing and selection live in news-lib.mjs.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { SOURCES_PATH, parseFeed, parseSources, selectHeadlines } from "./news-lib.mjs";

const TIMEOUT_MS = 15_000;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function fetchFeed(source) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(source.feed, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "market-pulse-news/1.0 (+https://github.com/saubyk/market-pulse)",
        Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = parseFeed(await res.text(), source.name);
    if (items.length === 0) throw new Error("no items in feed");
    return items;
  } finally {
    clearTimeout(timer);
  }
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
      console.log(`news: ${name} — ${r.value.length} items in feed`);
      all.push(...r.value);
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
