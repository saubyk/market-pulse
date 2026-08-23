// Pure helpers behind scripts/commentary.mjs (SPEC §3.8): the frozen
// system prompt, how a stats pack is rendered into the user turn, the
// JSON schema the model must answer in, validation of what comes back,
// and the shape of the committed documents. No I/O, no network.

export const MODEL = "claude-fable-5";
export const MAX_TOKENS = 4000;
export const EFFORT = "medium";

export const COMMENTARY_PATH = "public/data/commentary.json";
export const ARCHIVE_PATH = "public/data/commentary.jsonl";

// Display names the model should use. Keys match the stats pack.
export const NAMES = {
  btc: "Bitcoin",
  gold: "Gold",
  copper: "Copper",
  brent: "Brent crude",
  tnx: "US 10-year Treasury yield",
  tyx: "US 30-year Treasury yield",
  jpy: "USD/JPY",
  dxy: "US Dollar Index (DXY)",
  cad: "USD/CAD",
  inr: "USD/INR",
};

// Order instruments appear in the prompt: the eight tiles first, in the
// dashboard's section order, then the two picker rates.
export const PROMPT_ORDER = [
  "btc", "gold", "copper", "brent", "tnx", "tyx", "jpy", "dxy", "cad", "inr",
];

// Frozen: the whole point of keeping this text byte-stable is that it
// prompt-caches across days. Anything that changes daily goes in the
// user turn, after it.
export const SYSTEM_PROMPT = `You write a short daily note for "Market Pulse", a one-page dashboard showing ten instruments: Bitcoin, gold, copper, Brent crude, the US 10-year and 30-year Treasury yields, USD/JPY, the US Dollar Index, and the USD/CAD and USD/INR exchange rates. The readers are curious non-specialists who look at the dashboard once a day and want to understand what they are seeing.

You are given a JSON "stats pack" of precomputed figures: for each instrument its latest level and its change over one day, one week, one month, three months and year-to-date; its position within its 52-week range; a realized-volatility regime relative to its own past year; and a few cross-asset relationships (the 30y–10y yield-curve spread, how many ounces of gold one bitcoin buys, the copper/gold ratio, and the dollar's own move). Every number in the pack is the complete set of facts available to you.

Rules:
- Use only the figures in the stats pack. Do not bring in outside knowledge, news, events, policy decisions, or anything not in the pack. Do not guess at causes. If a relationship in the pack suggests a reading (for example, the dollar fell while gold rose), you may point out the relationship, but say it as an observation, not an explanation.
- No forecasts, no predictions, no advice, no recommendations, no "could", "may", "likely", "expect" about the future.
- Name the horizon for every figure you cite ("up 3% this week", "down 12 basis points over the month"). Quote yields in basis points for small moves and percent of level only when the reader would expect it. Round sensibly: a lay reader does not need three decimals.
- Lead with what actually moved or is notable — a large one-day move, a new 52-week extreme, an unusual volatility regime, a curve or cross-asset shift — not with a tour of every instrument. It is fine to leave quiet instruments unmentioned. Between two and four short paragraphs, roughly 120–220 words in total.
- If the pack says it was not a trading day (tradingDay is false), say so in one clause and describe the week or month instead of inventing a day's action. Instruments whose tradedToday is false are quoting their previous close; do not narrate them as having moved "today".
- Treat a null figure as unavailable and do not mention it.
- Plain English. No jargon without a gloss, no exclamation marks, no hype, no emoji. Calm, factual, a little dry. Write as "the" dashboard, never "I" or "we".
- Answer only with the JSON object described by the output schema: a short headline (under 90 characters, sentence case, no trailing period) and the paragraphs as an array of strings.`;

export const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    headline: {
      type: "string",
      description:
        "One line, under 90 characters, sentence case, no trailing period.",
    },
    body: {
      type: "array",
      description: "Two to four short paragraphs of plain text.",
      items: { type: "string" },
      minItems: 2,
      maxItems: 4,
    },
  },
  required: ["headline", "body"],
  additionalProperties: false,
};

// Trim the stats pack to what the model should see, in a stable order,
// with values rounded to what a reader could reasonably be told. The
// pack's raw precision (six decimals) only invites over-precise prose.
export function promptFacts(pack) {
  const instruments = {};
  for (const key of PROMPT_ORDER) {
    const s = pack.instruments?.[key];
    if (!s) continue;
    const yieldKey = key === "tnx" || key === "tyx";
    const horizon = (m) =>
      m == null
        ? null
        : yieldKey
          ? { bp: r(m.bp, 1), pct: r(m.pct, 2) }
          : { abs: r(m.abs, 4), pct: r(m.pct, 2) };
    instruments[NAMES[key]] = {
      last: r(s.last, 4),
      tradedToday: s.tradedToday,
      change: {
        day: horizon(s.d1),
        week: horizon(s.w1),
        month: horizon(s.m1),
        threeMonths: horizon(s.m3),
        yearToDate: horizon(s.ytd),
      },
      range52w: s.range52w
        ? {
            high: r(s.range52w.hi, 4),
            low: r(s.range52w.lo, 4),
            positionInRange: r(s.range52w.pos, 2),
          }
        : null,
      volatility:
        s.vol20 == null
          ? null
          : {
              annualizedPct: r(s.vol20, 1),
              vsOwnYearMedian: r(s.volRatio, 2),
              regime: s.volRegime,
            },
    };
  }

  const c = pack.cross ?? {};
  const cross = {};
  if (c.curve) {
    cross.yieldCurve30yMinus10y = {
      spreadPct: r(c.curve.spread, 3),
      monthAgoPct: r(c.curve.spread1mAgo, 3),
      changeOverMonthBp: r(c.curve.change1mBp, 1),
      shape: c.curve.shape,
    };
  }
  if (c.btcInGoldOz) {
    cross.goldOuncesPerBitcoin = {
      now: r(c.btcInGoldOz.now, 2),
      changeOverMonthPct: r(c.btcInGoldOz.m1?.pct, 2),
    };
  }
  if (c.copperGold) {
    cross.copperToGoldRatioX1000 = {
      now: r(c.copperGold.now, 3),
      changeOverMonthPct: r(c.copperGold.m1?.pct, 2),
    };
  }
  if (c.dollar) {
    cross.dollarIndexOwnMove = {
      dayPct: r(c.dollar.d1?.pct, 2),
      weekPct: r(c.dollar.w1?.pct, 2),
    };
  }

  return {
    date: pack.date,
    tradingDay: pack.tradingDay,
    instruments,
    crossAsset: cross,
  };
}

export function userMessage(pack) {
  return (
    `Stats pack for ${pack.date} (UTC)${pack.tradingDay ? "" : " — NOT a trading day for exchange-traded instruments"}:\n\n` +
    JSON.stringify(promptFacts(pack), null, 1) +
    "\n\nWrite today's note."
  );
}

// Validate the model's JSON against what the UI will render. Returns a
// list of problems; empty means good.
export function validateOutput(out) {
  const problems = [];
  if (!out || typeof out !== "object") return ["not an object"];
  if (typeof out.headline !== "string" || !out.headline.trim()) {
    problems.push("headline missing");
  } else if (out.headline.length > 120) {
    problems.push("headline too long");
  }
  if (!Array.isArray(out.body) || out.body.length < 1) {
    problems.push("body missing");
  } else {
    if (out.body.length > 5) problems.push("too many paragraphs");
    if (!out.body.every((p) => typeof p === "string" && p.trim()))
      problems.push("empty paragraph");
    const words = out.body.join(" ").split(/\s+/).filter(Boolean).length;
    if (words < 40) problems.push(`body too short (${words} words)`);
    if (words > 400) problems.push(`body too long (${words} words)`);
  }
  return problems;
}

// The committed document: what the dashboard fetches. `model` is the
// model that actually answered (a refusal fallback would show here).
export function buildDocument({ pack, output, model, usage, generatedAt }) {
  return {
    date: pack.date,
    generatedAt,
    model,
    tradingDay: pack.tradingDay,
    headline: output.headline.trim(),
    body: output.body.map((p) => p.trim()),
    stats: promptFacts(pack),
    usage: usage
      ? {
          inputTokens: usage.input_tokens ?? null,
          outputTokens: usage.output_tokens ?? null,
          cacheReadTokens: usage.cache_read_input_tokens ?? null,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? null,
        }
      : null,
  };
}

// The archive keeps every day's note, one per line, same dedupe-by-date
// rule as the snapshot log (a re-run replaces the day).
export function upsertArchive(text, doc) {
  const lines = text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l))
    .filter((d) => d.date !== doc.date);
  lines.push(doc);
  lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return lines.map((d) => JSON.stringify(d)).join("\n") + "\n";
}

// Pull the JSON text out of a Messages response: the first text block.
export function responseText(response) {
  for (const block of response.content ?? []) {
    if (block.type === "text") return block.text;
  }
  return null;
}

function r(n, dp) {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
