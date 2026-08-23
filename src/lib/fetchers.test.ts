import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYahoo } from "./fetchers.ts";

const DAY = 86_400;
// A Yahoo v8 chart result: daily bars at 13:30 UTC on consecutive
// weekdays ending on `lastTime`'s day, `meta.chartPreviousClose` set to
// the close *before the range* (what Yahoo actually sends).
function chart({
  price,
  closes,
  lastTime,
  rangePrev,
}: {
  price: number;
  closes: (number | null)[];
  lastTime: number;
  rangePrev: number;
}) {
  const dayStart = lastTime - (lastTime % DAY);
  const stamps: number[] = [];
  let t = dayStart + 13.5 * 3600;
  for (let i = 0; i < closes.length; i++) {
    stamps.unshift(t);
    do t -= DAY; while ([0, 6].includes(new Date(t * 1000).getUTCDay()));
  }
  return {
    meta: {
      regularMarketPrice: price,
      chartPreviousClose: rangePrev,
      regularMarketTime: lastTime,
    },
    timestamp: stamps,
    indicators: { quote: [{ close: closes }] },
  };
}

const FRI_CLOSE = Date.UTC(2026, 7, 21, 21, 0) / 1000; // Fri 2026-08-21 21:00 UTC

test("change reference is the prior trading day's close, not the close before the range", () => {
  // Month of gold closes; range-start reference 4046 (~month ago) vs
  // Thursday's 4380.
  const closes = [4046, 4100, 4200, 4300, 4380, 4680.6];
  const q = parseYahoo("gold", chart({ price: 4680.6, closes, lastTime: FRI_CLOSE, rangePrev: 4046 }));
  assert.equal(q.price, 4680.6);
  assert.equal(q.previousClose, 4380);
  assert.deepEqual(q.history, closes);
});

test("weekend quote still references Thursday: Friday's bar is 'today' for the quote", () => {
  // regularMarketTime is Friday; a Sunday fetch returns the same payload.
  const q = parseYahoo("brent", chart({ price: 94.39, closes: [90, 93.78, 94.39], lastTime: FRI_CLOSE, rangePrev: 80 }));
  assert.equal(q.previousClose, 93.78);
});

test("null bars are skipped when looking for the prior day", () => {
  const q = parseYahoo("copper", chart({ price: 6.587, closes: [6.4, 6.46, null, 6.587], lastTime: FRI_CLOSE, rangePrev: 5 }));
  assert.equal(q.previousClose, 6.46);
});

test("yields: the ÷10 heuristic applies to the derived reference too", () => {
  const q = parseYahoo("tnx", chart({ price: 47.38, closes: [46.0, 46.96, 47.38], lastTime: FRI_CLOSE, rangePrev: 43.3 }));
  assert.ok(Math.abs(q.price - 4.738) < 1e-9);
  assert.ok(Math.abs(q.previousClose - 4.696) < 1e-9);
});

test("falls back to chartPreviousClose only when the history has no earlier day", () => {
  const q = parseYahoo("dxy", chart({ price: 98.84, closes: [98.84], lastTime: FRI_CLOSE, rangePrev: 98.9 }));
  assert.equal(q.previousClose, 98.9);
});
