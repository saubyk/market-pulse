import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRecord,
  parseYahooChart,
  previousDayClose,
  upsertRecord,
  utcDate,
  YAHOO_KEYS,
} from "./snapshot-lib.mjs";

const DAY = 86_400;
// Bars at noon UTC on consecutive days ending on `time`'s day.
function dailyStamps(n, time) {
  const dayStart = time - (time % DAY);
  return Array.from({ length: n }, (_, i) => dayStart - (n - 1 - i) * DAY + DAY / 2);
}

function chart({ price, prev, time = 1_755_900_000, closes, stamps }) {
  stamps ??= dailyStamps(closes.length, time);
  return {
    chart: {
      result: [
        {
          meta: {
            regularMarketPrice: price,
            chartPreviousClose: prev,
            regularMarketTime: time,
          },
          timestamp: stamps,
          indicators: { quote: [{ close: closes }] },
        },
      ],
    },
  };
}

test("parseYahooChart extracts close/prev/ts and a [ms, close] history", () => {
  const time = 1_755_900_000;
  const q = parseYahooChart(
    "copper",
    chart({ price: 4.521, prev: 9.99, closes: [4.48, null, 4.5], time }),
  );
  assert.equal(q.close, 4.521);
  assert.equal(q.ts, time * 1000);
  // null closes are dropped together with their timestamp
  const [s0, , s2] = dailyStamps(3, time);
  assert.deepEqual(q.history, [
    [s0 * 1000, 4.48],
    [s2 * 1000, 4.5],
  ]);
  // prev is the prior trading day's close from the history — NOT
  // chartPreviousClose (9.99), which is the close before the range began.
  assert.equal(q.prev, 4.48);
});

test("parseYahooChart rescales ×10 yields but leaves percent yields alone", () => {
  const scaled = parseYahooChart(
    "tnx",
    chart({ price: 45.3, prev: 44.9, closes: [44.0, 45.0] }),
  );
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
  close(scaled.close, 4.53);
  close(scaled.prev, 4.4);
  const hist = scaled.history.map(([, c]) => c);
  close(hist[0], 4.4);
  close(hist[1], 4.5);

  const plain = parseYahooChart(
    "tyx",
    chart({ price: 4.9, prev: 4.85, closes: [4.8] }),
  );
  assert.equal(plain.close, 4.9);

  // Non-yield keys never rescale, however large the price.
  const gold = parseYahooChart(
    "gold",
    chart({ price: 2412, prev: 2404, closes: [2400] }),
  );
  assert.equal(gold.close, 2412);
});

test("parseYahooChart returns null for an unusable payload", () => {
  assert.equal(parseYahooChart("brent", { chart: { result: [] } }), null);
  assert.equal(parseYahooChart("brent", "<html>throttled</html>"), null);
  assert.equal(
    parseYahooChart("brent", { chart: { result: [{ meta: {} }] } }),
    null,
  );
});

test("previousDayClose skips same-day bars and handles edge cases", () => {
  const t = Date.UTC(2026, 7, 21, 20, 0); // Friday 20:00 UTC
  const bar = (daysAgo, hour = 14) => Date.UTC(2026, 7, 21 - daysAgo, hour);
  const history = [
    [bar(3), 1],
    [bar(1), 2],
    [bar(0), 3], // today's (possibly partial) bar
  ];
  assert.equal(previousDayClose(history, t), 2);
  // Quote from a weekend: the last bar is Friday's, still "earlier".
  assert.equal(previousDayClose(history, Date.UTC(2026, 7, 23, 12)), 3);
  // Only today's bar → nothing earlier.
  assert.equal(previousDayClose([[bar(0), 3]], t), null);
  // No timestamp → second-to-last bar.
  assert.equal(previousDayClose(history, null), 2);
  assert.equal(previousDayClose([[bar(0), 3]], null), null);
});

test("utcDate uses the UTC calendar day", () => {
  assert.equal(utcDate(Date.UTC(2026, 7, 22, 23, 59)), "2026-08-22");
  assert.equal(utcDate(Date.UTC(2026, 7, 23, 0, 1)), "2026-08-23");
});

test("buildRecord writes every key, nulls for failures, and lists errors", () => {
  const asOf = Date.UTC(2026, 7, 22, 22, 30);
  const quotes = Object.fromEntries(
    YAHOO_KEYS.map((k) => [k, { close: 1, prev: 0.9, ts: 5, history: [[1, 1]] }]),
  );
  quotes.dxy = null;
  const rec = buildRecord({
    asOf,
    quotes,
    btc: { spot: 62108, prev24h: null },
    errors: ["dxy"],
  });
  assert.equal(rec.date, "2026-08-22");
  assert.equal(rec.asOf, asOf);
  assert.deepEqual(rec.copper, { close: 1, prev: 0.9, ts: 5 }); // no history
  assert.equal(rec.dxy, null);
  assert.deepEqual(rec.btc, { spot: 62108, prev24h: null });
  assert.deepEqual(rec.errors, ["dxy"]);
  for (const k of YAHOO_KEYS) assert.ok(k in rec, `missing ${k}`);
});

test("buildRecord omits `errors` when there were none", () => {
  const rec = buildRecord({ asOf: 0, quotes: {}, btc: {} });
  assert.equal("errors" in rec, false);
  assert.equal(rec.copper, null);
  assert.deepEqual(rec.btc, { spot: null, prev24h: null });
});

test("upsertRecord appends a new date in order with a trailing newline", () => {
  const a = { date: "2026-08-20", v: 1 };
  const b = { date: "2026-08-21", v: 2 };
  const text = upsertRecord(upsertRecord("", a), b);
  assert.equal(text, `${JSON.stringify(a)}\n${JSON.stringify(b)}\n`);
});

test("upsertRecord replaces an existing line for the same date", () => {
  const start = `{"date":"2026-08-20","v":1}\n{"date":"2026-08-21","v":2}\n`;
  const out = upsertRecord(start, { date: "2026-08-20", v: 99 });
  assert.equal(out, `{"date":"2026-08-20","v":99}\n{"date":"2026-08-21","v":2}\n`);
});

test("upsertRecord sorts a backfilled earlier date into place", () => {
  const start = `{"date":"2026-08-21","v":2}\n`;
  const out = upsertRecord(start, { date: "2026-08-19", v: 0 });
  assert.equal(out, `{"date":"2026-08-19","v":0}\n{"date":"2026-08-21","v":2}\n`);
});

test("upsertRecord tolerates blank lines and a missing trailing newline", () => {
  const start = `\n{"date":"2026-08-20","v":1}`;
  const out = upsertRecord(start, { date: "2026-08-21", v: 2 });
  assert.equal(out, `{"date":"2026-08-20","v":1}\n{"date":"2026-08-21","v":2}\n`);
});
