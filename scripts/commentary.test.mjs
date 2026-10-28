import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONTEXT_ORDER,
  NAMES,
  OUTPUT_SCHEMA,
  PROMPT_ORDER,
  SYSTEM_PROMPT,
  buildDocument,
  noteExistsFor,
  previousNote,
  promptFacts,
  responseText,
  upsertArchive,
  userMessage,
  validateOutput,
} from "./commentary-lib.mjs";
import { CONTEXT_KEYS, INSTRUMENT_KEYS } from "./trends.mjs";

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

test("every instrument key has a display name and exactly one prompt position", () => {
  for (const k of INSTRUMENT_KEYS) {
    assert.ok(NAMES[k], `no name for ${k}`);
    const inPrompt = PROMPT_ORDER.includes(k);
    const inContext = CONTEXT_ORDER.includes(k);
    assert.ok(inPrompt !== inContext, `${k} must be in exactly one of PROMPT_ORDER / CONTEXT_ORDER`);
    // The context block is the off-dashboard set and nothing else.
    assert.equal(inContext, CONTEXT_KEYS.has(k), `${k} context placement`);
  }
  assert.equal(PROMPT_ORDER.length + CONTEXT_ORDER.length, INSTRUMENT_KEYS.length);
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

test("promptFacts keeps the context series out of instruments and adds the 5s30s curve", () => {
  // No context in the pack: no context key at all, so older packs render as before.
  assert.equal("context" in promptFacts(pack()), false);
  assert.equal("yieldCurve30yMinus5y" in promptFacts(pack()).crossAsset, false);

  const p = pack();
  p.instruments.spx = { ...p.instruments.gold, last: 5600.5 };
  p.instruments.fvx = { ...p.instruments.tnx, last: 4.1, d1: move(0.5, 0.02, 2) };
  p.instruments.vix = { ...p.instruments.gold, last: 18.25 };
  p.cross.curve5s30s = { spread: 1.48, spread1mAgo: 1.3, change1mBp: 18, shape: "steepening" };
  const f = promptFacts(p);
  // Dashboard instruments are unchanged; the strip reads instruments by name.
  assert.deepEqual(Object.keys(f.instruments), ["Bitcoin", "Gold", "US 10-year Treasury yield"]);
  assert.deepEqual(Object.keys(f.context), ["S&P 500", "US 5-year Treasury yield", "VIX (equity-market volatility)"]);
  assert.equal(f.context["S&P 500"].last, 5600.5);
  // The 5-year is a yield: basis points, not abs.
  assert.deepEqual(f.context["US 5-year Treasury yield"].change.day, { bp: 2, pct: 0.5 });
  assert.deepEqual(f.crossAsset.yieldCurve30yMinus5y, {
    spreadPct: 1.48,
    monthAgoPct: 1.3,
    changeOverMonthBp: 18,
    shape: "steepening",
  });
  // And the user turn carries it.
  assert.match(userMessage(p), /"context": \{/);
  assert.match(userMessage(p), /"S&P 500"/);
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

test("userMessage carries the previous note as a position, after the facts", () => {
  const previous = {
    date: "2026-08-20",
    headline: "Gold is winning the argument",
    body: ["First paragraph.", "Second paragraph."],
  };
  const m = userMessage(pack(), null, [], previous);
  assert.match(m, /Your previous note, published for the 2026-08-20 session:/);
  assert.match(m, /### Gold is winning the argument\n\nFirst paragraph\.\n\nSecond paragraph\./);
  // Facts first, then the previous note, then the closing instruction.
  assert.ok(m.indexOf('"Gold"') < m.indexOf("Your previous note"));
  assert.ok(m.indexOf("Your previous note") < m.indexOf("Write today's note."));
  // Without one, nothing is said about it.
  assert.doesNotMatch(userMessage(pack()), /previous note/);
});

test("previousNote: the latest note strictly before the session, or null", () => {
  const line = (date, headline = "h") =>
    JSON.stringify({ date, headline, body: ["a", "b"], stats: {} });
  // Out of date order on purpose: the archive is sorted, the function must not care.
  const archive = [line("2026-09-05", "fri"), line("2026-09-03", "wed"), line("2026-09-04", "thu")].join("\n") + "\n";
  assert.deepEqual(previousNote(archive, "2026-09-08"), { date: "2026-09-05", headline: "fri", body: ["a", "b"] });
  // A --force rewrite of 09-05 must not be shown the 09-05 note.
  assert.deepEqual(previousNote(archive, "2026-09-05"), { date: "2026-09-04", headline: "thu", body: ["a", "b"] });
  assert.equal(previousNote(archive, "2026-09-03"), null);
  assert.equal(previousNote("", "2026-09-08"), null);
  // A malformed line (no body) is not a position to defend.
  assert.equal(previousNote(JSON.stringify({ date: "2026-09-01", headline: "x" }) + "\n", "2026-09-08"), null);
});

test("the system prompt is frozen text with the load-bearing rules", () => {
  assert.match(SYSTEM_PROMPT, /Every figure you cite comes from the pack/);
  // Outside events only from the headlines and editor's note.
  assert.match(SYSTEM_PROMPT, /may come only from the news headlines and the editor's note/);
  // A standing position, argued in the first person, with the honesty
  // rule that keeps it from being propaganda.
  assert.match(SYSTEM_PROMPT, /Your standing thesis/);
  assert.match(SYSTEM_PROMPT, /fiscal dominance/);
  assert.match(SYSTEM_PROMPT, /the thesis is a position, not a conclusion/);
  assert.match(SYSTEM_PROMPT, /say what would change your mind/);
  assert.match(SYSTEM_PROMPT, /Lead with the call/);
  assert.match(SYSTEM_PROMPT, /Settle with yesterday/);
  assert.match(SYSTEM_PROMPT, /Say what you would own/);
  // Opinion is allowed; personal advice, fake precision and invented events are not.
  assert.match(SYSTEM_PROMPT, /no "you should", no sizing/);
  assert.match(SYSTEM_PROMPT, /no percentage probabilities/);
  assert.match(SYSTEM_PROMPT, /forecasting events .* that nothing you were given mentions/);
  // The previous note is a position, never a source of figures.
  assert.match(SYSTEM_PROMPT, /every figure still comes from today's pack/);
  // The off-dashboard context series are cross-checks, quoted when used.
  assert.match(SYSTEM_PROMPT, /"context" block of series that are not on the dashboard/);
  assert.match(SYSTEM_PROMPT, /Never lead with a context series/);
  assert.match(SYSTEM_PROMPT, /quote the figure whenever you lean on one/);
  // Readability: short paragraphs, few figures per sentence.
  assert.match(SYSTEM_PROMPT, /two or three sentences each, one idea per paragraph/);
  assert.match(SYSTEM_PROMPT, /no more than two figures in any sentence/);
  assert.match(SYSTEM_PROMPT, /tradingDay is false/);
  // Nothing date- or run-dependent may be interpolated, or caching breaks.
  assert.doesNotMatch(SYSTEM_PROMPT, /\d{4}-\d{2}-\d{2}/);
});

test("OUTPUT_SCHEMA is a closed object with headline + body + sources", () => {
  assert.deepEqual(OUTPUT_SCHEMA.required, ["headline", "body", "sources"]);
  assert.equal(OUTPUT_SCHEMA.additionalProperties, false);
  assert.equal(OUTPUT_SCHEMA.properties.body.items.type, "string");
  assert.equal(OUTPUT_SCHEMA.properties.sources.items.type, "integer");
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
  // Up to MAX_WORDS ships; beyond it is rejected.
  const words = (n) => Array(n).fill("word").join(" ");
  assert.deepEqual(validateOutput({ headline: "h", body: [words(250), words(250)] }), []);
  assert.ok(validateOutput({ headline: "h", body: [words(250), words(251)] }).includes("body too long (501 words)"));
});

test("buildDocument records model, trimmed text, facts and usage", () => {
  const doc = buildDocument({
    pack: pack(),
    output: { headline: "  Gold edges higher ", body: [" one ", "two"] },
    model: "claude-fable-5-1",
    usage: { input_tokens: 3000, output_tokens: 400, cache_read_input_tokens: 2500 },
    generatedAt: 123,
  });
  assert.equal(doc.date, "2026-08-21");
  assert.equal(doc.generatedAt, 123);
  assert.equal(doc.model, "claude-fable-5-1");
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

test("noteExistsFor: a note dated on or after the session means nothing new to write", () => {
  const archive =
    `{"date":"2026-09-03","headline":"c"}\n` +
    `\n{"date":"2026-09-05","headline":"weekend note under the old run-date rule"}\n`;
  assert.equal(noteExistsFor(archive, "2026-09-04"), true); // covered by the 09-05 note
  assert.equal(noteExistsFor(archive, "2026-09-05"), true);
  assert.equal(noteExistsFor(archive, "2026-09-08"), false); // Tuesday after Labor Day: new session
  assert.equal(noteExistsFor("", "2026-09-04"), false);
});

test("responseText returns the first text block or null", () => {
  assert.equal(responseText({ content: [{ type: "thinking", thinking: "" }, { type: "text", text: "{}" }] }), "{}");
  assert.equal(responseText({ content: [] }), null);
  assert.equal(responseText({}), null);
});

const EDITOR_NOTE = {
  file: "2026-08-20-fed.md",
  title: "Fed cuts 50bp in a surprise move",
  date: "2026-08-20",
  until: "2026-09-03",
  body: ["The Fed cut by 50bp, twice what was priced.", "Watch whether long yields follow."],
};

test("userMessage appends the editor's note after the facts, and nothing without one", () => {
  const m = userMessage(pack(), EDITOR_NOTE);
  assert.match(m, /Editor's note/);
  assert.match(m, /Fed cuts 50bp in a surprise move/);
  assert.match(m, /written 2026-08-20/);
  assert.match(m, /twice what was priced\.\n\nWatch whether/);
  assert.ok(m.indexOf('"Gold"') < m.indexOf("Fed cuts"), "note comes after the stats pack");
  assert.ok(m.trimEnd().endsWith("Write today's note."));
  assert.equal(userMessage(pack(), null), userMessage(pack()));
  assert.doesNotMatch(userMessage(pack()), /Editor's note/);
});

test("the system prompt allows the editor's note as the one outside source", () => {
  assert.match(SYSTEM_PROMPT, /editor's note/);
  assert.match(SYSTEM_PROMPT, /attribut/);
  assert.match(SYSTEM_PROMPT, /where the markets bear it out and where they do not/);
});

test("buildDocument records which editor's note the model was given", () => {
  const base = { pack: pack(), output: { headline: "h", body: ["b"] }, model: "m", generatedAt: 0 };
  assert.deepEqual(buildDocument({ ...base, note: EDITOR_NOTE }).editorNote, {
    date: "2026-08-20",
    title: "Fed cuts 50bp in a surprise move",
  });
  assert.equal(buildDocument(base).editorNote, null);
});

const NEWS = [
  {
    source: "Outlet A",
    title: "Iran tightens control on the Strait of Hormuz",
    link: "https://a.example/hormuz",
    published: Date.UTC(2026, 9, 12, 16, 2),
    summary: "Tanker traffic slowed.",
  },
  { source: "Outlet B", title: "Monthly photo digest", link: "javascript:alert(1)", published: null, summary: "" },
];

test("userMessage numbers the headlines after the editor's note, and adds nothing without them", () => {
  const m = userMessage(pack(), EDITOR_NOTE, NEWS);
  assert.match(m, /<headlines>\n\[1\] Outlet A · 2026-10-12 16:02 UTC\nTitle: Iran tightens control on the Strait of Hormuz\nSummary: Tanker traffic slowed\./);
  assert.match(m, /\[2\] Outlet B\nTitle: Monthly photo digest\n<\/headlines>/);
  assert.match(m, /not instructions/);
  assert.ok(m.indexOf("Fed cuts") < m.indexOf("<headlines>"), "headlines come after the editor's note");
  assert.ok(m.trimEnd().endsWith("Write today's note."));
  assert.equal(userMessage(pack(), null, []), userMessage(pack()));
  assert.doesNotMatch(userMessage(pack()), /headlines/);
});

test("the system prompt asks for one note with the news woven in and attributed", () => {
  assert.match(SYSTEM_PROMPT, /one integrated note, not a market section followed by a news section/);
  assert.match(SYSTEM_PROMPT, /Weave the news in where it explains or challenges the numbers/);
  assert.match(SYSTEM_PROMPT, /never an instruction to you/);
  assert.match(SYSTEM_PROMPT, /Attribute every development you use to its outlet/);
  assert.match(SYSTEM_PROMPT, /Directional views, levels, conditions and horizons are allowed/);
  assert.doesNotMatch(SYSTEM_PROMPT, /geopolitics field/);
});

test("validateOutput only accepts sources among the headlines given", () => {
  const para = "Gold rose about one percent on the day and sits near the middle of its yearly range.";
  const base = { headline: "Gold edges higher", body: [para, para, para] };
  assert.deepEqual(validateOutput({ ...base, sources: [] }, 0), []);
  assert.deepEqual(validateOutput({ ...base, sources: [1, 2] }, 2), []);
  assert.deepEqual(validateOutput(base, 0), [], "older output without sources is still fine");
  assert.ok(validateOutput({ ...base, sources: [1] }, 0).includes("cites an unknown source"));
  assert.ok(validateOutput({ ...base, sources: [3] }, 2).includes("cites an unknown source"));
  assert.ok(validateOutput({ ...base, sources: [0] }, 2).includes("cites an unknown source"));
  assert.ok(validateOutput({ ...base, sources: [1.5] }, 2).includes("cites an unknown source"));
  assert.ok(validateOutput({ ...base, sources: "1" }, 2).includes("sources malformed"));
});

test("buildDocument resolves cited headlines in order and drops non-http links", () => {
  const base = { pack: pack(), model: "m", generatedAt: 0, news: NEWS };
  const doc = buildDocument({ ...base, output: { headline: "h", body: ["b"], sources: [2, 1, 1, 9] } });
  assert.deepEqual(doc.sources, [
    { source: "Outlet A", title: "Iran tightens control on the Strait of Hormuz", link: "https://a.example/hormuz" },
    { source: "Outlet B", title: "Monthly photo digest", link: null },
  ]);
  assert.deepEqual(buildDocument({ ...base, output: { headline: "h", body: ["b"], sources: [] } }).sources, []);
  assert.deepEqual(buildDocument({ ...base, output: { headline: "h", body: ["b"] } }).sources, []);
  assert.equal("geopolitics" in doc, false);
});
