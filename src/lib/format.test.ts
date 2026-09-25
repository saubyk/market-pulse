import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtCloseTag } from "./format.ts";
import { parseYahoo } from "./fetchers.ts";

// ^TNX's regular session on Thu 2026-09-24, as Yahoo sends it:
// 07:20–14:00 Chicago (CDT) = 12:20–19:00 UTC = 8:20am–3pm New York.
const START = Date.UTC(2026, 8, 24, 12, 20);
const END = Date.UTC(2026, 8, 24, 19, 0);
const session = { start: START, end: END };

test("no tag while the session is open", () => {
  assert.equal(fmtCloseTag(session, START), null);
  assert.equal(fmtCloseTag(session, END - 1), null);
});

test("tags the close, in New York time, once the session has ended", () => {
  assert.equal(fmtCloseTag(session, END), "CLOSE 3PM ET");
  assert.equal(fmtCloseTag(session, Date.UTC(2026, 8, 25, 1, 14)), "CLOSE 3PM ET");
});

test("tags before the open, when Yahoo has rolled to the next session", () => {
  assert.equal(fmtCloseTag(session, START - 60_000), "CLOSE 3PM ET");
});

test("New York time follows standard time and keeps non-round minutes", () => {
  // Winter: 13:30 CST close = 19:30 UTC = 2:30pm EST.
  const winter = { start: Date.UTC(2026, 11, 1, 13, 20), end: Date.UTC(2026, 11, 1, 19, 30) };
  assert.equal(fmtCloseTag(winter, Date.UTC(2026, 11, 1, 22)), "CLOSE 2:30PM ET");
});

test("no session known, no tag", () => {
  assert.equal(fmtCloseTag(undefined, END), null);
});

test("parseYahoo carries meta.currentTradingPeriod.regular as ms", () => {
  const q = parseYahoo("tnx", {
    meta: {
      regularMarketPrice: 5.162,
      regularMarketTime: END / 1000 - 6,
      currentTradingPeriod: { regular: { start: START / 1000, end: END / 1000, timezone: "CDT" } },
    },
    timestamp: [END / 1000 - 86_400, END / 1000 - 6],
    indicators: { quote: [{ close: [5.114, 5.162] }] },
  });
  assert.deepEqual(q.session, session);
});

test("parseYahoo omits a missing or malformed session", () => {
  const base = { regularMarketPrice: 98.8, regularMarketTime: END / 1000 };
  const payload = (meta: object) => ({ meta: { ...base, ...meta }, timestamp: [], indicators: { quote: [{ close: [] }] } });
  assert.equal(parseYahoo("dxy", payload({})).session, undefined);
  assert.equal(parseYahoo("dxy", payload({ currentTradingPeriod: { regular: { start: 5, end: 5 } } })).session, undefined);
});
