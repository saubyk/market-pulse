import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildStatsPack,
  closeAtOrBefore,
  crossAssetStats,
  instrumentStats,
  medianRollingVol,
  mergeSeries,
  range52w,
  ratioSeries,
  realizedVol,
  seriesFromSnapshots,
  spreadSeries,
  tradedOn,
  volRegime,
} from "./trends.mjs";

const DAY = 86_400_000;
// Bars at 14:00 UTC on consecutive *weekdays* ending on `end` (a
// Friday unless told otherwise), values from `fn(i)` with i=0 the oldest.
const FRI = Date.UTC(2026, 7, 21, 14); // Fri 2026-08-21
function weekdays(n, fn, end = FRI) {
  const out = [];
  let ms = end;
  let i = n - 1;
  while (out.length < n) {
    const dow = new Date(ms).getUTCDay();
    if (dow !== 0 && dow !== 6) {
      out.unshift([ms, fn(i)]);
      i--;
    }
    ms -= DAY;
  }
  return out;
}
const near = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) < tol, `${a} not within ${tol} of ${b}`);

test("seriesFromSnapshots dates Yahoo bars by quote ts, btc by run time", () => {
  const recs = [
    { asOf: 2 * DAY, gold: { close: 2, ts: 2 * DAY - 5000 }, btc: { spot: 20 } },
    { asOf: 1 * DAY, gold: null, btc: { spot: null } },
    { asOf: 3 * DAY, gold: { close: 3 }, btc: { spot: 30 } }, // no ts → asOf
  ];
  assert.deepEqual(seriesFromSnapshots(recs, "gold"), [[2 * DAY - 5000, 2], [3 * DAY, 3]]);
  assert.deepEqual(seriesFromSnapshots(recs, "btc"), [[2 * DAY, 20], [3 * DAY, 30]]);
});

test("a weekend snapshot of Friday's close lands on Friday, not the weekend", () => {
  const hist = weekdays(30, (i) => 100 + i); // last bar Fri, close 129
  const sunday = FRI + 2 * DAY;
  const snapshots = [{ asOf: sunday, gold: { close: 129, ts: FRI + 3_600_000 } }];
  const pack = buildStatsPack({ asOf: sunday, histories: { gold: hist }, snapshots });
  const g = pack.instruments.gold;
  assert.equal(pack.barsPerInstrument.gold, 30); // merged onto Friday, no extra bar
  assert.equal(g.tradedToday, false);
  assert.equal(g.d1.abs, 1); // Fri vs Thu, not Sun vs Fri
  assert.equal(pack.tradingDay, false);
});

test("mergeSeries prefers the snapshot bar on a shared date and sorts", () => {
  const own = [[2 * DAY + 1000, 99]];
  const filler = [[3 * DAY, 3], [1 * DAY, 1], [2 * DAY, 2]];
  assert.deepEqual(mergeSeries(own, filler), [
    [1 * DAY, 1],
    [2 * DAY + 1000, 99],
    [3 * DAY, 3],
  ]);
  assert.deepEqual(mergeSeries([], undefined), []);
});

test("closeAtOrBefore returns the last bar not after the cutoff", () => {
  const s = [[10, 1], [20, 2], [30, 3]];
  assert.deepEqual(closeAtOrBefore(s, 20), [20, 2]);
  assert.deepEqual(closeAtOrBefore(s, 25), [20, 2]);
  assert.equal(closeAtOrBefore(s, 5), null);
});

test("instrumentStats: horizons over a weekday series, including weekends", () => {
  // 300 weekdays, price = 100 + i, ending Fri 2026-08-21.
  const s = weekdays(300, (i) => 100 + i);
  const st = instrumentStats("gold", s, FRI);
  assert.equal(st.last, 399);
  assert.equal(st.tradedToday, true);
  assert.deepEqual(st.d1, { abs: 1, pct: round3(1 / 398 * 100) });
  // 7 calendar days back lands on the previous Friday = 5 bars earlier.
  assert.equal(st.w1.abs, 5);
  // 30 days back = Wed 2026-07-22 — 22 weekdays earlier.
  assert.equal(st.m1.abs, 22);
  // YTD: last bar of 2025 is Wed 2025-12-31.
  const dec31 = closeAtOrBefore(s, Date.UTC(2025, 11, 31, 23, 59));
  assert.equal(new Date(dec31[0]).toISOString().slice(0, 10), "2025-12-31");
  assert.equal(st.ytd.abs, 399 - dec31[1]);
  // Monotonic rise: at the 52-week high.
  assert.equal(st.range52w.hi, 399);
  assert.equal(st.range52w.pos, 1);
});

test("instrumentStats reports basis points for yields only", () => {
  const s = weekdays(3, (i) => 4.5 + i * 0.01);
  const y = instrumentStats("tnx", s, FRI);
  near(y.d1.bp, 1);
  near(y.d1.abs, 0.01);
  const g = instrumentStats("gold", s, FRI);
  assert.equal("bp" in g.d1, false);
});

test("instrumentStats returns nulls where history is too short", () => {
  const s = weekdays(3, (i) => 10 + i);
  const st = instrumentStats("brent", s, FRI);
  assert.equal(st.m1, null);
  assert.equal(st.ytd, null);
  assert.equal(st.range52w, null);
  assert.equal(st.vol20, null);
  assert.equal(st.volRegime, null);
  assert.equal(instrumentStats("brent", [], FRI), null);
});

test("tradedOn compares UTC dates; a weekend run sees Friday's bar as stale", () => {
  const s = weekdays(5, () => 1);
  assert.equal(tradedOn(s, FRI + 6 * 3_600_000), true);
  assert.equal(tradedOn(s, FRI + 2 * DAY), false); // Sunday
  assert.equal(tradedOn([], FRI), false);
});

test("range52w needs 120 bars and positions the last close in the window", () => {
  assert.equal(range52w(weekdays(100, (i) => i)), null);
  // 200 bars: 0..199 then crash to 100 → pos = 100/199.
  const s = weekdays(200, (i) => (i === 199 ? 100 : i));
  const r = range52w(s);
  assert.equal(r.hi, 198);
  assert.equal(r.lo, 0);
  near(r.pos, 100 / 198, 1e-3);
  // Flat series: midpoint by convention.
  assert.equal(range52w(weekdays(150, () => 5)).pos, 0.5);
});

test("realizedVol is zero for a constant series and scales with noise", () => {
  assert.equal(realizedVol(weekdays(30, () => 100)), 0);
  // Alternating ±1% daily: log-return stdev ≈ 0.00995 → ×√252 ×100.
  const alt = weekdays(30, (i) => (i % 2 ? 101 : 100));
  const v = realizedVol(alt);
  assert.ok(v > 15 && v < 17, `vol ${v}`);
  assert.equal(realizedVol(weekdays(10, () => 1)), null);
});

test("medianRollingVol + volRegime classify today against the year", () => {
  // 260 calm bars (±0.1%) then 21 wild bars (±3%).
  const s = weekdays(281, (i) => (i < 260 ? (i % 2 ? 100.1 : 100) : i % 2 ? 103 : 100));
  const st = instrumentStats("copper", s, FRI);
  assert.ok(st.volRatio > 1.4, `ratio ${st.volRatio}`);
  assert.equal(st.volRegime, "choppy");
  assert.equal(volRegime(0.5), "calm");
  assert.equal(volRegime(1), "normal");
  assert.equal(volRegime(null), null);
  assert.equal(medianRollingVol(weekdays(30, () => 1)), null);
});

test("ratioSeries / spreadSeries align on shared dates only", () => {
  const a = [[1 * DAY, 10], [2 * DAY, 20], [3 * DAY, 30]];
  const b = [[1 * DAY, 2], [3 * DAY + 5000, 3]];
  assert.deepEqual(ratioSeries(a, b), [[1 * DAY, 5], [3 * DAY, 10]]);
  assert.deepEqual(spreadSeries(a, b), [[1 * DAY, 8], [3 * DAY, 27]]);
  assert.deepEqual(ratioSeries(a, undefined), []);
});

test("crossAssetStats: curve steepening, btc-in-gold, copper/gold, dollar", () => {
  const n = 40;
  const series = {
    tnx: weekdays(n, () => 4.0),
    tyx: weekdays(n, (i) => 4.5 + (i === n - 1 ? 0.2 : 0)), // spread 0.5 → 0.7 today
    gold: weekdays(n, () => 2000),
    btc: weekdays(n, (i) => 60000 + i * 1000),
    copper: weekdays(n, () => 4),
    dxy: weekdays(n, (i) => 100 - (i === n - 1 ? 1 : 0)),
  };
  const c = crossAssetStats(series);
  near(c.curve.spread, 0.7);
  near(c.curve.spread1mAgo, 0.5);
  near(c.curve.change1mBp, 20);
  assert.equal(c.curve.shape, "steepening");
  near(c.btcInGoldOz.now, (60000 + 39 * 1000) / 2000);
  assert.ok(c.btcInGoldOz.m1.pct > 0);
  near(c.copperGold.now, 2); // 4/2000 × 1000
  assert.equal(c.copperGold.m1.abs, 0);
  // abs is in the same ×1000 units as `now`
  const c2 = crossAssetStats({
    copper: weekdays(n, (i) => (i === n - 1 ? 5 : 4)),
    gold: weekdays(n, () => 2000),
  });
  near(c2.copperGold.now, 2.5);
  near(c2.copperGold.m1.abs, 0.5);
  near(c.dollar.d1.pct, -1);
  assert.deepEqual(crossAssetStats({}), {});
});

test("buildStatsPack merges snapshots over histories and flags the trading day", () => {
  const hist = { gold: weekdays(10, (i) => 100 + i) };
  const snapshots = [
    // Same date as the last history bar, different value: snapshot wins.
    { asOf: FRI + 7 * 3_600_000, gold: { close: 555 }, btc: { spot: 70000 } },
  ];
  const pack = buildStatsPack({ asOf: FRI + 8 * 3_600_000, histories: hist, snapshots });
  assert.equal(pack.date, "2026-08-21");
  assert.equal(pack.instruments.gold.last, 555);
  assert.equal(pack.barsPerInstrument.gold, 10);
  assert.equal(pack.barsPerInstrument.btc, 1);
  assert.equal(pack.instruments.brent, null);
  assert.equal(pack.tradingDay, true);

  // A Sunday run where only BTC and the FX pairs print is not a trading
  // day — FX quotes from the Sunday-evening Asia open don't count.
  const sunday = FRI + 2 * DAY;
  const p2 = buildStatsPack({
    asOf: sunday,
    histories: hist,
    snapshots: [{ asOf: sunday, btc: { spot: 1 }, jpy: { close: 150, ts: sunday } }],
  });
  assert.equal(p2.tradingDay, false);
  assert.equal(p2.instruments.btc.tradedToday, true);
  assert.equal(p2.instruments.jpy.tradedToday, true);
});

function round3(n) {
  return Math.round(n * 1000) / 1000;
}
