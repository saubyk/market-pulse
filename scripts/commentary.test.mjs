import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NAMES,
  OUTPUT_SCHEMA,
  PROMPT_ORDER,
  SYSTEM_PROMPT,
  buildDocument,
  promptFacts,
  responseText,
  upsertArchive,
  userMessage,
  validateOutput,
} from "./commentary-lib.mjs";
import { INSTRUMENT_KEYS } from "./trends.mjs";

function move(pct, abs = pct, bp) {
  const m = { abs, pct };
  if (bp != null) m.bp = bp;
  return m;
}

function pack(overrides = {}) {
  const inst = (extra = {}) => ({
    last: 100.123456,
    lastTs: 1,
    tradedToday: true,
    d1: move(1.234567, 1.2),
    w1: move(2),
    m1: move(3),
    m3: null,
    ytd: move(5),
    range52w: { hi: 120, lo: 80, pos: 0.50321 },
    vol20: 17.699,
    volMedian1y: 26.1,
    volRatio: 0.678,
    volRegime: "calm",
    ...extra,
  });
  return {
    date: "2026-08-21",
    asOf: 1,
    tradingDay: true,
    barsPerInstrument: {},
    instruments: {
      gold: inst(),
      tnx: inst({ last: 4.738, d1: move(0.894, 0.042, 4.2) }),
      btc: inst(),
      brent: null,
    },
    cross: {
      curve: { spread: 0.538, spread1mAgo: 0.468, change1mBp: 7, shape: "steepening" },
      btcInGoldOz: { now: 16.421, m1: move(2.706) },
      copperGold: { now: 1.4073, m1: move(-9.535) },
      dollar: { d1: move(0.039), w1: move(-0.834) },
    },
    ...overrides,
  };
}

test("every instrument key has a display name and a prompt position", () => {
  for (const k of INSTRUMENT_KEYS) {
    assert.ok(NAMES[k], `no name for ${k}`);
    assert.ok(PROMPT_ORDER.includes(k), `${k} not in PROMPT_ORDER`);
  }
  assert.equal(PROMPT_ORDER.length, INSTRUMENT_KEYS.length);
});

test("promptFacts rounds, renames, orders and drops missing instruments", () => {
  const f = promptFacts(pack());
  assert.deepEqual(Object.keys(f.instruments), ["Bitcoin", "Gold", "US 10-year Treasury yield"]);
  const gold = f.instruments.Gold;
  assert.equal(gold.last, 100.1235);
  assert.deepEqual(gold.change.day, { abs: 1.2, pct: 1.23 });
  assert.equal(gold.change.threeMonths, null);
  assert.equal(gold.range52w.positionInRange, 0.5);
  assert.deepEqual(gold.volatility, { annualizedPct: 17.7, vsOwnYearMedian: 0.68, regime: "calm" });
  // Yields are given in basis points, not abs.
  assert.deepEqual(f.instruments["US 10-year Treasury yield"].change.day, { bp: 4.2, pct: 0.89 });
  assert.equal(f.crossAsset.yieldCurve30yMinus10y.shape, "steepening");
  assert.equal(f.crossAsset.goldOuncesPerBitcoin.now, 16.42);
  assert.equal(f.crossAsset.dollarIndexOwnMove.weekPct, -0.83);
  assert.equal(f.tradingDay, true);
});

test("promptFacts tolerates an empty pack", () => {
  const f = promptFacts({ date: "2026-01-01", tradingDay: false, instruments: {}, cross: {} });
  assert.deepEqual(f.instruments, {});
  assert.deepEqual(f.crossAsset, {});
});

test("userMessage flags non-trading days and embeds the facts", () => {
  const m = userMessage(pack({ tradingDay: false }));
  assert.match(m, /NOT a trading day/);
  assert.match(m, /"Gold"/);
  assert.doesNotMatch(userMessage(pack()), /NOT a trading day/);
});

test("the system prompt is frozen text with the load-bearing rules", () => {
  assert.match(SYSTEM_PROMPT, /Use only the figures in the stats pack/);
  assert.match(SYSTEM_PROMPT, /No forecasts/);
  assert.match(SYSTEM_PROMPT, /tradingDay is false/);
  // Nothing date- or run-dependent may be interpolated, or caching breaks.
  assert.doesNotMatch(SYSTEM_PROMPT, /\d{4}-\d{2}-\d{2}/);
});

test("OUTPUT_SCHEMA is a closed object with headline + body", () => {
  assert.deepEqual(OUTPUT_SCHEMA.required, ["headline", "body"]);
  assert.equal(OUTPUT_SCHEMA.additionalProperties, false);
  assert.equal(OUTPUT_SCHEMA.properties.body.items.type, "string");
});

test("validateOutput accepts a sane note and rejects the broken ones", () => {
  const para = "Gold rose about one percent on the day and sits near the middle of its yearly range.";
  const good = { headline: "Gold edges higher", body: [para, para, para] };
  assert.deepEqual(validateOutput(good), []);
  assert.ok(validateOutput(null).length);
  assert.ok(validateOutput({ headline: "", body: [para, para, para] }).includes("headline missing"));
  assert.ok(validateOutput({ headline: "x".repeat(130), body: [para, para, para] }).includes("headline too long"));
  assert.ok(validateOutput({ headline: "h", body: [] }).includes("body missing"));
  assert.ok(validateOutput({ headline: "h", body: [para, ""] }).includes("empty paragraph"));
  assert.ok(validateOutput({ headline: "h", body: ["Too short."] }).some((p) => p.startsWith("body too short")));
  const long = Array(6).fill(para);
  assert.ok(validateOutput({ headline: "h", body: long }).includes("too many paragraphs"));
});

test("buildDocument records model, trimmed text, facts and usage", () => {
  const doc = buildDocument({
    pack: pack(),
    output: { headline: "  Gold edges higher ", body: [" one ", "two"] },
    model: "claude-fable-5",
    usage: { input_tokens: 3000, output_tokens: 400, cache_read_input_tokens: 2500 },
    generatedAt: 123,
  });
  assert.equal(doc.date, "2026-08-21");
  assert.equal(doc.generatedAt, 123);
  assert.equal(doc.model, "claude-fable-5");
  assert.equal(doc.headline, "Gold edges higher");
  assert.deepEqual(doc.body, ["one", "two"]);
  assert.equal(doc.stats.instruments.Gold.last, 100.1235);
  assert.deepEqual(doc.usage, {
    inputTokens: 3000,
    outputTokens: 400,
    cacheReadTokens: 2500,
    cacheWriteTokens: null,
  });
  assert.equal(buildDocument({ pack: pack(), output: { headline: "h", body: ["b"] }, model: "m", generatedAt: 0 }).usage, null);
});

test("upsertArchive replaces the same date and keeps order", () => {
  const a = { date: "2026-08-20", headline: "a" };
  const b = { date: "2026-08-21", headline: "b" };
  let text = upsertArchive("", b);
  text = upsertArchive(text, a);
  assert.equal(text, `${JSON.stringify(a)}\n${JSON.stringify(b)}\n`);
  text = upsertArchive(text, { date: "2026-08-21", headline: "b2" });
  assert.equal(text, `${JSON.stringify(a)}\n{"date":"2026-08-21","headline":"b2"}\n`);
});

test("responseText returns the first text block or null", () => {
  assert.equal(responseText({ content: [{ type: "thinking", thinking: "" }, { type: "text", text: "{}" }] }), "{}");
  assert.equal(responseText({ content: [] }), null);
  assert.equal(responseText({}), null);
});
