import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXCHANGE_KEYS,
  buildRecord,
  dateStartMs,
  parseYahooChart,
  sessionDate,
  upsertRecord,
  utcDate,
  zonedDate,
  zonedTime,
  YAHOO_KEYS,
} from "./snapshot-lib.mjs";

const NY = "America/New_York";
const CHI = "America/Chicago";
const LON = "Europe/London";

// A Yahoo v8 chart payload. `bars` is [[unix seconds, close], ...] as
// Yahoo stamps them (futures at exchange-local midnight, FX at London
// midnight); `time` is meta.regularMarketTime in seconds.
function chart({ price, prev = 0, time, bars, tz }) {
  return {
    chart: {
      result: [
        {
          meta: {
            regularMarketPrice: price,
            chartPreviousClose: prev,
            regularMarketTime: time,
            exchangeTimezoneName: tz,
          },
          timestamp: bars.map(([t]) => t),
          indicators: { quote: [{ close: bars.map(([, c]) => c) }] },
        },
      ],
    },
  };
}

// Futures bars as Yahoo sends them in US summer: 04:00 UTC = 00:00 EDT.
const s = (y, m, d, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min) / 1000;
const SEP_BARS = [
  [s(2026, 9, 1, 4), 4348],
  [s(2026, 9, 2, 4), 4366.3],
  [s(2026, 9, 3, 4), 4491.7],
  [s(2026, 9, 4, 4), 4429.8],
];

test("zonedDate: exchange-local calendar date, not the UTC one", () => {
  // 04:00 UTC is midnight in New York (summer) → same date.
  assert.equal(zonedDate(Date.UTC(2026, 8, 4, 4), NY), "2026-09-04");
  // 23:00 UTC Sunday is 00:00 Monday in London (summer) → Monday.
  assert.equal(zonedDate(Date.UTC(2026, 7, 30, 23), LON), "2026-08-31");
  // ...and 22:00 UTC Sunday is still Sunday there.
  assert.equal(zonedDate(Date.UTC(2026, 7, 30, 22), LON), "2026-08-30");
  // 05:00 UTC is midnight in New York in winter.
  assert.equal(zonedDate(Date.UTC(2026, 0, 15, 5), NY), "2026-01-15");
  assert.equal(zonedDate(Date.UTC(2026, 0, 15, 4, 59), NY), "2026-01-14");
});

test("zonedTime: 17:00 New York is 21:00 UTC in summer and 22:00 UTC in winter", () => {
  assert.equal(zonedTime("2026-09-04", 17, NY), Date.UTC(2026, 8, 4, 21));
  assert.equal(zonedTime("2026-01-15", 17, NY), Date.UTC(2026, 0, 15, 22));
  assert.equal(zonedTime("2026-09-04", 15, CHI), Date.UTC(2026, 8, 4, 20));
  assert.equal(zonedTime("2026-09-04", 0, "UTC"), Date.UTC(2026, 8, 4));
});

test("a run inside the close window records the day's settled bar, not the live quote", () => {
  // Friday 21:45 UTC: the session ended at 21:00; regularMarketPrice is
  // the 17:00 ET last trade, the bar close is the settlement.
  const q = parseYahooChart(
    "gold",
    chart({ price: 4476.6, time: s(2026, 9, 4, 20, 59), bars: SEP_BARS, tz: NY }),
    Date.UTC(2026, 8, 4, 21, 45),
  );
  assert.equal(q.close, 4429.8);
  assert.equal(q.prev, 4491.7);
  assert.equal(q.date, "2026-09-04");
  assert.equal(q.ts, Date.UTC(2026, 8, 4, 21));
  assert.equal(q.history.length, 4);
  // History timestamps sit on the session date in UTC terms.
  assert.deepEqual(q.history.map(([ms]) => utcDate(ms)), [
    "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04",
  ]);
});

test("a run after the futures reopen still records today's settled bar", () => {
  // Tuesday 23:27 UTC, the evening session open: the quote is a live
  // print from Wednesday's session and must be ignored.
  const q = parseYahooChart(
    "gold",
    chart({ price: 4376.8, time: s(2026, 9, 1, 23, 17), bars: SEP_BARS.slice(0, 1), tz: NY }),
    Date.UTC(2026, 8, 1, 23, 27),
  );
  assert.equal(q.close, 4348);
  assert.equal(q.date, "2026-09-01");
});

test("a run that drifted past midnight records the previous session, not the in-progress bar", () => {
  // 05:31 UTC Wednesday: Yahoo already shows an in-progress bar for
  // Wednesday (stamped 04:00 UTC); its session ends 21:00 UTC — not yet.
  const bars = [...SEP_BARS.slice(0, 1), [s(2026, 9, 2, 4), 4380]];
  const q = parseYahooChart(
    "gold",
    chart({ price: 4380, time: s(2026, 9, 2, 5, 21), bars, tz: NY }),
    Date.UTC(2026, 8, 2, 5, 31),
  );
  assert.equal(q.close, 4348);
  assert.equal(q.date, "2026-09-01");
  assert.equal(q.history.length, 1); // the unsettled bar is not history
});

test("a Sunday-evening run resolves to Friday's session", () => {
  const bars = [[s(2026, 8, 28, 4), 4500], [s(2026, 8, 31, 4), 4510]]; // Fri + Monday's open
  const q = parseYahooChart(
    "copper",
    chart({ price: 4510, time: s(2026, 8, 30, 23, 30), bars, tz: NY }),
    Date.UTC(2026, 7, 30, 23, 41),
  );
  assert.equal(q.date, "2026-08-28");
  assert.equal(q.close, 4500);
});

test("the settle instant follows the exchange's clock through daylight time", () => {
  // Winter: the session ends 22:00 UTC. A 21:30 UTC run is *before* it.
  const bars = [[s(2026, 1, 14, 5), 100], [s(2026, 1, 15, 5), 101]];
  const early = parseYahooChart(
    "brent",
    chart({ price: 101, time: s(2026, 1, 15, 21), bars, tz: NY }),
    Date.UTC(2026, 0, 15, 21, 30),
  );
  assert.equal(early.date, "2026-01-14");
  const late = parseYahooChart(
    "brent",
    chart({ price: 101, time: s(2026, 1, 15, 21, 59), bars, tz: NY }),
    Date.UTC(2026, 0, 15, 22, 13),
  );
  assert.equal(late.date, "2026-01-15");
  // The yields settle at 15:00 Chicago = 21:00 UTC in winter.
  const chi = [[s(2026, 1, 15, 13, 20), 4.5]];
  assert.equal(
    parseYahooChart("tnx", chart({ price: 4.5, time: s(2026, 1, 15, 20), bars: chi, tz: CHI }), Date.UTC(2026, 0, 15, 20, 30)),
    null,
  );
  assert.equal(
    parseYahooChart("tnx", chart({ price: 4.5, time: s(2026, 1, 15, 20), bars: chi, tz: CHI }), Date.UTC(2026, 0, 15, 21, 1)).date,
    "2026-01-15",
  );
});

test("yields rescale ×10 quotes, settled bars included", () => {
  const bars = [[s(2026, 9, 3, 12, 20), 44.0], [s(2026, 9, 4, 12, 20), 45.3]];
  const q = parseYahooChart(
    "tnx",
    chart({ price: 45.3, time: s(2026, 9, 4, 18, 59), bars, tz: CHI }),
    Date.UTC(2026, 8, 4, 21),
  );
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
  near(q.close, 4.53);
  near(q.prev, 4.4);
  // Percent-quoted yields are left alone; non-yields never rescale.
  const plain = parseYahooChart(
    "tyx",
    chart({ price: 4.9, time: s(2026, 9, 4, 18, 59), bars: [[s(2026, 9, 4, 12, 20), 4.9]], tz: CHI }),
    Date.UTC(2026, 8, 4, 21),
  );
  assert.equal(plain.close, 4.9);
  const gold = parseYahooChart(
    "gold",
    chart({ price: 2412, time: s(2026, 9, 4, 20, 59), bars: [[s(2026, 9, 4, 4), 2400]], tz: NY }),
    Date.UTC(2026, 8, 4, 21),
  );
  assert.equal(gold.close, 2400);
});

test("FX keeps the live quote, dated and prev'd by London calendar date", () => {
  // Bars stamped 23:00 UTC = London midnight of the *next* day.
  const bars = [
    [s(2026, 9, 1, 23), 160.2], // Wed 09-02's bar
    [s(2026, 9, 2, 23), 158.9], // Thu 09-03's bar
    [s(2026, 9, 4, 20, 59), 156.2], // Fri's, stamped at the last print
  ];
  const q = parseYahooChart(
    "jpy",
    chart({ price: 156.221, time: s(2026, 9, 4, 20, 59), bars, tz: LON }),
    Date.UTC(2026, 8, 4, 22, 13),
  );
  assert.equal(q.close, 156.221);
  assert.equal(q.date, "2026-09-04");
  assert.equal(q.prev, 158.9);
  assert.deepEqual(q.history.map(([ms]) => utcDate(ms)), ["2026-09-02", "2026-09-03", "2026-09-04"]);
  assert.equal(q.history[0][0], dateStartMs("2026-09-02"));
});

test("parseYahooChart returns null for an unusable payload", () => {
  assert.equal(parseYahooChart("brent", { chart: { result: [] } }), null);
  assert.equal(parseYahooChart("brent", "<html>throttled</html>"), null);
  assert.equal(parseYahooChart("brent", { chart: { result: [{ meta: {} }] } }), null);
  // A price but no settled bar yet (fresh listing) → nothing to record.
  assert.equal(
    parseYahooChart("brent", chart({ price: 90, time: s(2026, 9, 4, 20), bars: [], tz: NY }), Date.UTC(2026, 8, 4, 22)),
    null,
  );
});

test("sessionDate is the latest settled date among exchange keys", () => {
  assert.equal(sessionDate({}), null);
  assert.equal(sessionDate({ jpy: { date: "2026-09-05" } }), null); // FX doesn't count
  assert.equal(
    sessionDate({ gold: { date: "2026-09-04" }, tnx: { date: "2026-09-04" }, jpy: { date: "2026-09-05" } }),
    "2026-09-04",
  );
  // Yields settle earlier than futures: mid-afternoon they disagree and
  // the later one wins (the line is replaced once the rest settle).
  assert.equal(sessionDate({ gold: { date: "2026-09-03" }, tnx: { date: "2026-09-04" } }), "2026-09-04");
  for (const k of EXCHANGE_KEYS) assert.ok(YAHOO_KEYS.includes(k));
});

test("utcDate uses the UTC calendar day", () => {
  assert.equal(utcDate(Date.UTC(2026, 7, 22, 23, 59)), "2026-08-22");
  assert.equal(utcDate(Date.UTC(2026, 7, 23, 0, 1)), "2026-08-23");
});

test("buildRecord dates the line by the session, writes every key, and lists errors", () => {
  const asOf = Date.UTC(2026, 8, 2, 5, 31); // drifted into Wednesday
  const quotes = Object.fromEntries(
    YAHOO_KEYS.map((k) => [k, { close: 1, prev: 0.9, ts: 5, date: "2026-09-01", history: [[1, 1]] }]),
  );
  quotes.dxy = null;
  const rec = buildRecord({
    asOf,
    date: "2026-09-01",
    quotes,
    btc: { spot: 62108, prev24h: null },
    errors: ["dxy"],
  });
  assert.equal(rec.date, "2026-09-01");
  assert.equal(rec.asOf, asOf);
  assert.deepEqual(rec.copper, { close: 1, prev: 0.9, ts: 5 }); // no history, no date
  assert.equal(rec.dxy, null);
  assert.deepEqual(rec.btc, { spot: 62108, prev24h: null });
  assert.deepEqual(rec.errors, ["dxy"]);
  for (const k of YAHOO_KEYS) assert.ok(k in rec, `missing ${k}`);
});

test("buildRecord falls back to the run's UTC date and omits `errors` when none", () => {
  const rec = buildRecord({ asOf: Date.UTC(2026, 8, 5, 23, 5), quotes: {}, btc: {} });
  assert.equal(rec.date, "2026-09-05");
  assert.equal("errors" in rec, false);
  assert.equal(rec.copper, null);
  assert.deepEqual(rec.btc, { spot: null, prev24h: null });
});

test("buildRecord aligns an FX quote from after the session to that session's bar", () => {
  // Run drifted to 05:31 UTC Wednesday: London already dates the live
  // yen quote Wednesday, but the line describes Tuesday's session.
  const jpy = {
    close: 158.0,
    prev: 160.2,
    ts: Date.UTC(2026, 8, 2, 5, 21),
    date: "2026-09-02",
    history: [
      [dateStartMs("2026-08-31"), 159.7],
      [dateStartMs("2026-09-01"), 160.2],
      [dateStartMs("2026-09-02"), 158.0],
    ],
  };
  const rec = buildRecord({ asOf: 0, date: "2026-09-01", quotes: { jpy }, btc: {} });
  assert.deepEqual(rec.jpy, { close: 160.2, prev: 159.7, ts: dateStartMs("2026-09-01") });
  // Same-day or earlier quotes pass through untouched.
  const same = buildRecord({ asOf: 0, date: "2026-09-02", quotes: { jpy }, btc: {} });
  assert.deepEqual(same.jpy, { close: 158.0, prev: 160.2, ts: jpy.ts });
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
