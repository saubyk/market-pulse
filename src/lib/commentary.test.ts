import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commentaryAgeDays,
  fmtMove,
  isStale,
  needsRemote,
  newerNote,
  type Commentary,
} from "./commentary.ts";

function note(date: string): Commentary {
  return {
    date,
    generatedAt: 0,
    model: "test",
    tradingDay: true,
    headline: `note for ${date}`,
    body: ["…"],
  };
}

// 2026-09-06 08:00 UTC — the day after the local note in these tests.
const NOW = new Date(Date.UTC(2026, 8, 6, 8));

test("commentaryAgeDays counts whole UTC days regardless of time of day", () => {
  assert.equal(commentaryAgeDays("2026-09-06", NOW), 0);
  assert.equal(commentaryAgeDays("2026-09-05", NOW), 1);
  assert.equal(commentaryAgeDays("2026-09-05", new Date(Date.UTC(2026, 8, 6, 23, 59))), 1);
  assert.equal(commentaryAgeDays("2026-08-23", NOW), 14);
});

test("isStale flips after STALE_AFTER_DAYS whole days", () => {
  assert.equal(isStale(note("2026-09-03"), NOW), false);
  assert.equal(isStale(note("2026-09-02"), NOW), true);
});

test("needsRemote: only a local note that is not today's triggers the upstream check", () => {
  // No local note means no panel at all — never ask upstream.
  assert.equal(needsRemote(null, NOW), false);
  assert.equal(needsRemote(note("2026-09-06"), NOW), false);
  assert.equal(needsRemote(note("2026-09-05"), NOW), true);
  assert.equal(needsRemote(note("2026-08-23"), NOW), true);
});

test("newerNote prefers the newer date and keeps local on ties or remote failure", () => {
  const local = note("2026-09-01");
  assert.equal(newerNote(local, note("2026-09-05")).date, "2026-09-05");
  assert.equal(newerNote(local, note("2026-09-01")), local);
  assert.equal(newerNote(local, note("2026-08-30")), local);
  assert.equal(newerNote(local, null), local);
});

test("fmtMove renders percent, basis points, and a dash for nothing", () => {
  assert.equal(fmtMove({ pct: 6.87 }), "+6.9%");
  assert.equal(fmtMove({ pct: -2.26 }), "-2.3%");
  assert.equal(fmtMove({ pct: 1.74, bp: 8.1 }, true), "+8bp");
  assert.equal(fmtMove({ pct: -0.5, bp: -12.4 }, true), "-12bp");
  assert.equal(fmtMove(null), "—");
  assert.equal(fmtMove({ pct: null }), "—");
});
