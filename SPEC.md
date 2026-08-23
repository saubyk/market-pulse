# Market Pulse — Specification

A minimal, browser-only dashboard that displays financial instruments side-by-side across four categories — **Energy & Metals** (Copper, Brent crude), **US Treasuries** (10Y, 30Y yields), **Scarce Assets** (Bitcoin, Gold), and **Currencies** (USD/JPY, US Dollar Index). The dollar-priced instruments can be displayed in USD (default), CAD or INR. A collapsed "Today's read" row carries a short daily note, written by Claude from the day's figures in CI, that puts the numbers in context for a lay reader. Designed to run entirely as a static SPA — no backend, no API keys in the browser, no auth.

---

## 1. Goals & Non-Goals

### Goals
- Single-page dashboard showing live or near-live prices for the eight instruments above.
- Zero-config setup: clone, install, run. No API keys, no server.
- Honest about data freshness: live where possible, clearly labeled as delayed otherwise.
- Robust to API hiccups: a failed tile must not break the others.
- Optional display of the dollar-priced instruments in CAD or INR, converted at a live-fetched rate that the UI discloses.
- Deployable as static files to Netlify, Vercel, GitHub Pages, or Cloudflare Pages.
- A daily snapshot log of every instrument's close, kept in the repo (§3.6), and a daily LLM-written note generated from it in CI (§3.8) and shown in the dashboard (§5.7) — context for a lay reader, produced without any key or call from the browser.

### Non-Goals
- Historical charting beyond a small sparkline.
- User accounts, watchlists, or per-user persistence.
- Trading, alerts, or notifications.
- Mobile-first layout (desktop-first is fine; should not break on mobile but no special tuning required).
- Real-time tick streaming for non-BTC instruments (free-tier limitation; out of scope).
- Commentary generated in the browser or on demand: the note is a static file produced once a day; the dashboard only reads it.

---

## 2. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Build tool | **Vite** | Fastest cold start, simple static output. |
| CI scripts | **Node 20, plain ESM** + `@anthropic-ai/sdk` (devDependency) | The daily snapshot/commentary job (§3.6–3.8). The SDK never enters the browser bundle. |
| Framework | **React 18 + TypeScript** | Component model fits the eight-tile layout; TS catches the kinds of bugs that show up in API parsing. |
| Styling | **Plain CSS or inline styles** | The design is custom and small; a utility framework is overkill. Tailwind is acceptable if the implementer prefers it. |
| State | **`useState` + `useEffect`** | No global state needed. |
| Charts | **Hand-rolled SVG** | One small sparkline component, ~30 lines. No chart library dependency. |
| HTTP | **Native `fetch`** | No axios, no react-query. |
| Fonts | **Google Fonts**: `Instrument Serif` (display, italic) + `JetBrains Mono` (body, numerics) | |

No backend. No environment variables. No build-time secrets.

---

## 3. Data Sources

All data sources are free and require no API key. Only Yahoo Finance is reached through a public CORS proxy because it does not send `Access-Control-Allow-Origin` headers; Coinbase and CoinGecko send permissive CORS headers and are called directly.

### 3.1 CORS proxy

Yahoo sends no CORS headers, so its requests are proxied. The **primary** is a self-hosted Cloudflare Worker (`worker/` — deploy with `npx wrangler deploy`): pinned to Yahoo's v8 chart endpoint only, origin-locked to the deployed dashboard's domain plus localhost (`ALLOWED_ORIGINS` in `worker/index.js`), and edge-cached for 120s so any number of visitors produce at most one Yahoo fetch per symbol per TTL per edge location. The free public proxies stay in the rotation as fallback so a fresh clone works with zero deploys (deployed forks run on the fallbacks until they deploy their own worker):

```ts
const PROXIES = [
  "https://market-pulse-proxy.<subdomain>.workers.dev/?url=", // self-hosted primary
  "https://corsproxy.io/?",            // free tier is localhost/dev-only since mid-2026; 403s fast in prod
  "https://api.allorigins.win/raw?url=", // valid but slow / occasionally 5xx
  "https://api.codetabs.com/v1/proxy?quest=", // throttled by Yahoo edge
];
```

Each Yahoo fetch walks the rotation, **validating the parsed JSON inside the loop** (a `200` with a non-Yahoo body falls through to the next proxy), caps each attempt at 8s with an `AbortController`, and retries the whole rotation once after ~700ms. See `fetchYahooOnce` / `fetchYahoo` in `src/lib/fetchers.ts`.

The worker is optional infrastructure, not a dependency: the app must keep working (on the public fallbacks) when the first entry is unreachable, preserving the clone-and-run goal in §1.

Besides the browser origin lock, the worker has one server-to-server path: a request with **no** `Origin` header is answered if it carries the `MP_PROXY_TOKEN` secret (`npx wrangler secret put MP_PROXY_TOKEN`) in an `X-MP-Token` header, compared in constant time. This exists only for the daily snapshot job (§3.6), whose GitHub runner IPs Yahoo tends to block. A token presented alongside a disallowed `Origin` is still rejected; an unset secret disables the path.

**Known risk:** the public fallbacks are free services and can rate-limit or go offline simultaneously — history: all three did in July 2026, which is what motivated the worker. See §9.

### 3.2 Bitcoin — Coinbase (live, no proxy)

**Endpoint:**
```
GET https://api.coinbase.com/v2/prices/BTC-USD/spot
```

**Response shape:**
```json
{ "data": { "base": "BTC", "currency": "USD", "amount": "62000.00" } }
```

Sends `Access-Control-Allow-Origin: *`. Call directly from the browser.

### 3.3 Bitcoin 24h history — CoinGecko (for sparkline + 24h change)

**Endpoint:**
```
GET https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=1
```

**Response shape:**
```json
{ "prices": [[timestamp_ms, price], ...], "market_caps": [...], "total_volumes": [...] }
```

Use `prices[0][1]` as the 24h-ago reference for computing change. Use the full array as sparkline data. CORS-enabled, no key required.

**Rate limit:** ~10–30 req/min on the free tier. Polling this once every 5 minutes keeps usage trivial.

### 3.4 Copper, Brent, Treasuries, Gold, FX — Yahoo Finance (15-min delayed, via proxy)

**Endpoint pattern:**
```
GET https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}?interval=1d&range=1mo
```

| Instrument | Symbol |
|---|---|
| Copper | `HG=F` |
| Brent Crude | `BZ=F` |
| US 10-Year Treasury Yield | `^TNX` |
| US 30-Year Treasury Yield | `^TYX` |
| Gold | `GC=F` |
| USD/JPY exchange rate | `JPY=X` |
| US Dollar Index (DXY) | `DX-Y.NYB` |
| USD/CAD rate — currency picker, not a tile | `CAD=X` |
| USD/INR rate — currency picker, not a tile | `INR=X` |

The last two back the currency picker (§5.6) rather than a tile. They are fetched only while that currency is selected, through the same rotation/retry/last-good machinery as the tiles, so USD — the base — costs no request at all.

**Response shape (abridged):**
```json
{
  "chart": {
    "result": [{
      "meta": {
        "regularMarketPrice": 4.521,
        "chartPreviousClose": 4.498,
        "previousClose": 4.498,
        "regularMarketTime": 1734567890,
        "symbol": "HG=F"
      },
      "timestamp": [1731000000, ...],
      "indicators": {
        "quote": [{
          "close": [4.48, 4.50, ...],
          "open": [...], "high": [...], "low": [...], "volume": [...]
        }]
      }
    }]
  }
}
```

Extract:
- Current price: `result.meta.regularMarketPrice`
- Reference for change: the **previous trading day's close, derived from the bars** — the last non-null `close` whose `timestamp` falls on an earlier UTC day than `regularMarketTime`. `meta.chartPreviousClose` is **not** the prior day's close: it is the close before the requested range began (≈ a month ago for `range=1mo`), and using it made every tile's change row a month-over-month move (issue #7, fixed Aug 2026). It survives only as a fallback when every bar is from the quote's own day.
- Sparkline data: `result.indicators.quote[0].close`, filtered for non-null values
- Last update timestamp: `result.meta.regularMarketTime * 1000`

### 3.5 `^TNX` quirk — must handle

Yahoo has historically reported `^TNX` two different ways:
- As a percentage directly (e.g. `4.53` for 4.53%)
- As percentage × 10 (e.g. `45.3` for 4.53%)

**Required handling:** after fetching, if the raw price is greater than 20, divide price, previousClose, and the full history array by 10. This auto-detects the convention without hardcoding either.

```ts
const divisor = key === "tnx" && raw.price > 20 ? 10 : 1;
```

### 3.6 Daily snapshot log (CI, not the browser)

The dashboard's own fetching is untouched by this section — the tiles keep `range=1mo` and the 30-day sparkline. Separately, `scripts/snapshot.mjs` runs once a day in GitHub Actions (`.github/workflows/daily-commentary.yml`, cron 21:30 UTC after the US bond close, plus `workflow_dispatch` for manual catch-up) and records the day's closes for later trend analysis and the planned LLM-written commentary (issue #6).

What it does:
- Fetches `interval=1d&range=1y` for the nine Yahoo symbols in §3.4 (seven tiles + `CAD=X`/`INR=X`), serially with a 400ms gap, trying Yahoo directly → the worker with `X-MP-Token` (§3.1; only if `MP_PROXY_TOKEN` is set) → `allorigins` → `codetabs`, with a 10s timeout per attempt and the JSON validated per attempt. Then Coinbase spot and CoinGecko's 24h reference for BTC, as in §3.2–3.3.
- Applies the same `^TNX`/`^TYX` ÷10 heuristic as §3.5.
- Upserts **one JSON line per UTC date** into `public/data/snapshots.jsonl`, sorted by date. Re-running on the same day replaces that day's line, never duplicates it. The file lives in `public/` so Vite ships it with the bundle and it is fetchable from the site's own origin.
- Commits the file to `main` with the Actions bot identity, then dispatches `deploy-satusd.yml` explicitly (pushes made with `GITHUB_TOKEN` never trigger other workflows on their own).

Record shape (`null` for any source that failed that day; failed keys are listed in `errors` so a partial day is recorded honestly rather than lost — the job only exits non-zero if *every* source failed):

```json
{"date":"2026-08-23","asOf":1787458140660,
 "copper":{"close":6.587,"prev":6.46,"ts":1787345999000}, "brent":{...}, "tnx":{...}, "tyx":{...},
 "gold":{...}, "jpy":{...}, "dxy":{...}, "cad":{...}, "inr":{...},
 "btc":{"spot":76799.995,"prev24h":78301.61},
 "errors":["inr"]}
```

`prev` is the previous *trading day's* close, derived from the history as the last bar on an earlier UTC day than the quote. Yahoo's `meta.chartPreviousClose` is deliberately **not** used here: it is the close before the *requested range* began (a year earlier for `range=1y`), not the prior day's.

`node scripts/snapshot.mjs --history-out <file>` additionally dumps the full year of `[unix ms, close]` bars per symbol (plus 365 daily BTC closes from CoinGecko's `market_chart?days=365&interval=daily`, best-effort) to a scratch file for the trends step (§3.7); that dump is not committed. The pure parts (`scripts/snapshot-lib.mjs`) are covered by `npm test` (Node's built-in runner, no dependency). The job needs no secrets to run; `MP_PROXY_TOKEN` only improves its odds against Yahoo's datacenter-IP blocking.

### 3.7 Trend statistics (the stats pack)

`scripts/trends.mjs` is a pure module (no I/O, no React; `npm test` covers it) that turns daily close series into the **only facts the commentary model is given**. `scripts/stats.mjs` is its CLI: `node scripts/stats.mjs --history <dump from §3.6> --out stats.json`.

**Series.** For each of the ten instruments (nine Yahoo keys + `btc`) the series is the snapshot log merged over the fetched history, one bar per UTC date, **the log winning on shared dates** — it is what we observed and committed; the fetch only fills dates we don't own yet. Yahoo snapshot bars are dated by the quote's `ts`, not the run time, so a weekend run re-recording Friday's close lands on Friday. BTC spot is live and dated by the run time.

**Per instrument** (`instruments.<key>`; `null` horizons where history is too short):
- `last`, `lastTs`, `tradedToday` — whether a bar is dated on the run's UTC day.
- `d1` (vs the previous trading day's bar), `w1`/`m1`/`m3` (vs the last close at or before 7/30/91 calendar days earlier — weekends and holidays just make the reference slightly older), `ytd` (vs the last close of the prior calendar year). Each is `{abs, pct}`; yields (`tnx`, `tyx`) also carry `bp`.
- `range52w` — `{hi, lo, pos}` over the trailing 365 days, `pos` 0 = at the low, 1 = at the high; `null` under 120 bars.
- `vol20` — annualized standard deviation of the last 20 daily log returns, in %; `volMedian1y` — median of that rolling measure across the year; `volRatio` = `vol20 / volMedian1y`; `volRegime` — `calm` (< 0.7), `normal`, `choppy` (> 1.4). The regime is relative to the instrument's own year, never an absolute threshold.

**Cross-asset** (`cross`, each present only when both inputs exist):
- `curve` — 30Y − 10Y in percentage points: `spread`, `spread1mAgo`, `change1mBp`, `shape` (`steepening` / `flattening` / `unchanged`).
- `btcInGoldOz` — ounces of gold one bitcoin buys, `now` and `m1` change (rising = BTC outperforming gold).
- `copperGold` — copper ÷ gold ×1000 (reads as ≈1.4), `now` and `m1`; a growth-vs-fear gauge.
- `dollar` — DXY's own `d1` and `w1`, to be read alongside the four dollar-priced instruments' moves.

**Pack-level:** `date`, `asOf`, `tradingDay` (any *exchange-traded* instrument — copper, Brent, the yields, gold, DXY — printed a bar today; FX pairs quote 24/5 and print on Sunday evenings, and BTC never stops, so they don't count. The prompt uses it to avoid narrating movement on a weekend or holiday), `barsPerInstrument` (how much history each stat rests on).

### 3.8 Daily commentary (LLM-written, in CI)

`scripts/commentary.mjs` turns the stats pack into the day's note. It runs as the last data step of `daily-commentary.yml`, after `snapshot.mjs` and `stats.mjs`. The pure parts — the frozen system prompt, the rendering of the pack into the user turn, the output schema, validation, the document shape — live in `scripts/commentary-lib.mjs` and are covered by `npm test`.

**Model and request.** `claude-fable-5` through `@anthropic-ai/sdk` (a devDependency; CI-only, never in the Vite bundle). Fable 5's thinking is always on, so no `thinking` parameter is sent; depth is `output_config.effort: "medium"`, `max_tokens` 4000. The answer is constrained by `output_config.format` to a JSON schema `{headline, body: string[2..4]}`, so there is no prose parsing. Server-side refusal fallbacks are enabled (`fallbacks: "default"` under the `server-side-fallback-2026-07-01` beta): a classifier decline is re-run on Anthropic's recommended fallback within the same call, and **whichever model actually answered is recorded** in the output's `model` field. The system prompt is a single cached block (`cache_control`) and contains nothing date-dependent; everything that changes daily is in the user turn.

**What the model is given** — only the stats pack (§3.7), rounded to reader precision and renamed to display names (`promptFacts()`). The system prompt forbids outside knowledge, causes, forecasts and advice; requires a horizon on every figure; says to lead with what moved rather than tour every instrument; and, when `tradingDay` is false, to say so and describe the week or month instead of inventing a session. Two to four short paragraphs, ~120–220 words.

**Outputs** (both in `public/`, committed daily):
- `public/data/commentary.json` — the latest note, what the dashboard fetches (§5.7, milestone 4):

```json
{
  "date": "2026-08-21",
  "generatedAt": 1787440000000,
  "model": "claude-fable-5",
  "tradingDay": true,
  "headline": "Yields edge lower as gold pushes toward its yearly high",
  "body": ["…", "…"],
  "stats": { "…the promptFacts rendering of the pack…" },
  "usage": { "inputTokens": 3100, "outputTokens": 420, "cacheReadTokens": 2600, "cacheWriteTokens": null }
}
```

- `public/data/commentary.jsonl` — every day's document, one per line, same replace-by-date rule as the snapshot log.

**Failure behaviour.** No `ANTHROPIC_API_KEY` (forks, local runs): prints a notice and exits 0 — the snapshot still commits. A refusal that survives the fallback chain, a truncated answer, non-JSON, or a note that fails validation (empty headline, < 40 or > 400 words, > 5 paragraphs): exits 1 with the offending text in the log, nothing is written, and the previous day's `commentary.json` stays in place — the dashboard's staleness display (§5.7) is the user-facing signal. `node scripts/commentary.mjs --stats stats.json --dry-run` prints the exact prompt without calling the API.

**Cost.** ~3–4K input tokens (mostly the cached system prompt) and ~500 output per day ≈ $2/month at Fable 5 rates. Per-run token usage is logged and stored in the document.

**Org requirement.** Fable 5 requires 30-day data retention; an organization configured for zero data retention gets `400 invalid_request_error` on every request.

---

## 4. Polling Strategy

| Instrument | Source | Interval | Rationale |
|---|---|---|---|
| BTC spot | Coinbase | **8 seconds** | True real-time feel. |
| BTC 24h history | CoinGecko | **5 minutes** | Reference for change/sparkline; doesn't need to be fresh. |
| Copper / Brent / 10Y / 30Y / Gold / USD-JPY / DXY | Yahoo (proxied) | **5 minutes**, staggered ~400ms apart | Data is 15-min delayed anyway; polling faster adds nothing. The stagger keeps the symbol fetches under the free proxies' per-IP burst threshold. |
| Selected currency's USD rate (`CAD=X` / `INR=X`) | Yahoo (proxied) | **5 minutes**, stagger slot 8 | Only while a non-USD currency is selected; USD is the base and fetches nothing. Never more than one rate in flight. |
| Clock display | local | **1 second** | UI only. |

All polling uses `setInterval` inside `useEffect`, with proper cleanup on unmount and a `cancel` flag to prevent stale `setState` calls from late responses.

Initial load: fire all fetches in parallel on mount. Don't await anything before first paint — each tile renders its own "loading…" state independently.

---

## 5. UI Specification

### 5.1 Layout

```
┌─────────────────────────────────────────────────────────┐
│  FREE-TIER MARKET TERMINAL                              │
│  Market Pulse              THU, MAY 21, 2026            │
│                                       14:32:08          │
│  ───────────────────────────────────────────            │
│  SCARCE ASSETS                                          │
│  ┌─────────────────────┐ ┌─────────────────────┐        │
│  │ BTC-USD · BITCOIN   │ │ GC=F · GOLD         │        │
│  │ $62,108             │ │ $2,412              │        │
│  │ ▲ +1,240  +2.03%    │ │ ▲ +8.40  +0.35%     │        │
│  └─────────────────────┘ └─────────────────────┘        │
│  ENERGY & METALS                                        │
│  ┌─────────────────────┐ ┌─────────────────────┐        │
│  │ HG=F · COPPER       │ │ BZ=F · BRENT CRUDE  │        │
│  │ $4.521              │ │ $66.84              │        │
│  │ ▲ +0.023  +0.51%    │ │ ▲ +0.31  +0.47%     │        │
│  └─────────────────────┘ └─────────────────────┘        │
│  US TREASURIES                                          │
│  ┌─────────────────────┐ ┌─────────────────────┐        │
│  │ ^TNX · US 10Y YIELD │ │ ^TYX · US 30Y YIELD │        │
│  │ 4.234               │ │ 4.512               │        │
│  │ ▲ +0.012  +0.28%    │ │ ▲ +0.009  +0.20%    │        │
│  └─────────────────────┘ └─────────────────────┘        │
│  CURRENCIES                                             │
│  ┌─────────────────────┐ ┌─────────────────────┐        │
│  │ JPY=X · USD/JPY     │ │ DX-Y.NYB · DOLLAR…  │        │
│  │ 159.46              │ │ 99.88               │        │
│  │ ▼ -0.52  -0.33%     │ │ ▼ -0.21  -0.21%     │        │
│  └─────────────────────┘ └─────────────────────┘        │
│  ───────────────────────────────────────────            │
│  SOURCES — YAHOO (PROXIED) · COINBASE · COINGECKO       │
└─────────────────────────────────────────────────────────┘
```

- Centered container, max-width ~980px (stacked layout).
- Four labeled sections (Scarce Assets, Energy & Metals, US Treasuries, Currencies), each a two-column grid of 2 tiles, gap ~12px. Sections are unboxed — just the uppercase label above the tile grid. Vertical spacing throughout (page padding, header/footer margins, tile internals) is deliberately compact so all eight tiles fit one desktop viewport height (~755px or taller) with no vertical scrolling.
- Header above, source footer below. The eyebrow row carries the satusd.com link, the currency picker (§5.6) and the theme toggle, so neither control costs vertical space. Directly under the header divider sits the single-row "Today's read" toggle (§5.7), which adds one line to the one-viewport budget and nothing more until opened.
- **Responsive:** at ≤640px the grids collapse to a single column, page/tile padding tightens, and the title font scales with `clamp()`. Sections always stack vertically in a ~980px column, so desktop shows at most two tiles per row (there is deliberately no wider multi-section-per-row layout). The breakpoint is implemented as CSS classes (`.tile-grid`, `.app-shell`, `.app-frame`, `.tile`) in `styles.css` rather than inline styles, since inline styles outrank media queries. Header eyebrow / title / source rows use `flex-wrap` to fold gracefully.

### 5.2 Tile contents (each tile)

1. **Top row:** ticker label (e.g. `HG=F · COPPER`) on the left; on the right the freshness tag (`LIVE` with pulsing dot for BTC, `DLY 15m` muted for others) followed by a muted `· UPD HH:MM:SS` timestamp of the last successful fetch (omitted until first data arrives).
2. **Sublabel:** small italic serif description, e.g. "Copper futures, $/lb". Its unit tracks the selected display currency ("Copper futures, C$/lb") on the four convertible tiles.
3. **Price:** large monospace, light weight (~300), with currency prefix.
4. **Change row:** arrow + absolute change + percent change, colored green/red. Sparkline aligned to the right of this row.

### 5.3 Design tokens & theming

Two themes, implemented as CSS custom properties in `src/styles.css`: `:root` holds the **light** theme (the default) and `:root[data-theme="dark"]` the dark overrides. `src/lib/theme.ts` exports the same tokens as `var(--…)` strings for inline styles; SVG colors (the sparkline) must be applied via `style`, since presentation attributes don't resolve `var()`.

Surfaces, text tiers, and accent adopt **satusd.com's** token values verbatim (its `style.css`) so the two properties read as one site — keep them in sync when adjusting either:

| Token | Light (default) | Dark |
|---|---|---|
| `--bg-top` / `--bg-bottom` | `#ffffff` / `#f0eeea` | `#181818` / `#0b0b0b` |
| `--panel` (tile surface) | `#ffffff` | `#141414` |
| `--border` | `#e4e0da` | `#242424` |
| `--text` | `#1a1a1a` | `#f1f1f1` |
| `--text-dim` | `#55524d` | `#9a9a9a` |
| `--muted` | `#6b6862` | `#7c7c7c` |
| `--faint` | `#cdc7be` | `#3c3c3c` |
| `--up` | `#467a2f` | `#8fb877` (sage) |
| `--down` | `#ab4e29` | `#d97757` (terracotta) |
| `--accent` | `#f7931a` | `#f7931a` |
| `--accent-text` | `#a35f00` | `#f7931a` |

Two accent tokens on purpose, mirroring satusd: full bitcoin orange is only ~2.2:1 on white, so `--accent` is reserved for decorative marks (the LIVE pulsing dot) and `--accent-text` — darkened in light mode — for anything text-sized (the LIVE label). `--up`/`--down` are market-pulse-specific: the sage/terracotta of the original dark design, deepened in light mode to hold ~4.5:1 at text size on the white tile.

**Theme switching:** a toggle in the header eyebrow (it shows the theme it switches *to*: moon while light, sun while dark) flips `data-theme` on `<html>` and persists the choice to `localStorage("theme")` — the same key satusd.com uses, so the preference carries across satusd.com and satusd.com/market-pulse. An inline script in `index.html` resolves the theme before first paint (light unless an explicit saved `"dark"`; OS `prefers-color-scheme` is deliberately ignored, matching satusd) and keeps `<meta name="theme-color">` in sync (`#ffffff` / `#0b0b0b`).

Typography:
- Display: `"Instrument Serif", serif`, italic, weight 400.
- Body / numerics: `"JetBrains Mono", monospace`, weights 300/400/500.

No bright neons, no purple gradients. Aesthetic target: refined Bloomberg terminal, not crypto-bro dashboard.

### 5.4 Animations

- One-time fade-up on mount, staggered per tile (`animation-delay` of 0.08s × index).
- Pulsing dot on the `LIVE` indicator: 1.6s ease-in-out infinite, opacity 1 → 0.35 → 1.
- No hover effects required.
- Color transitions on price change are out of scope (nice-to-have, not required).

### 5.5 Sparkline component

Hand-rolled SVG, ~140×36 px:
- `<polyline>` for the trend line, stroke = price-direction color, width 1.25.
- `<polygon>` underneath for the fill, using a vertical gradient from the line color at 18% opacity fading to 0.
- `<circle>` at the last point.
- Defensive: render an empty `<div>` of the same dimensions if `data.length < 2`.

### 5.6 Currency selection

A segmented `USD · CAD · INR` control in the header eyebrow, left of the theme toggle (`components/CurrencyPicker.tsx`; active and hover styling lives in `styles.css` as `.ccy-btn`, since inline styles can't express `:hover`). The choice persists to `localStorage("mp-currency")` — its own key, *not* shared with satusd.com, which has no currency concept.

**What converts.** Only the four dollar-priced tiles: BTC, Gold, Copper, Brent. Price, absolute change, sparkline history and the sublabel's unit all follow the selection. The other four never convert, in any currency — the 10Y/30Y yields are percentages, DXY is a unitless index, and USD/JPY is itself a USD pair.

**Conversion is display-only.** Fetched and persisted quotes stay in USD and are multiplied by the rate at render time, so switching currency never disturbs a poll loop or a stored last-good value. Percent change is therefore identical in every currency; the absolute change is converted. Switching currencies drops the previous rate (the last-good ref in `useYahooPoll` is keyed by symbol), so CAD numbers can never appear under a rupee sign.

**Disclosure.** The footer's source line names the rate actually applied — `FX USD/CAD 1.3764 · UPD 14:32:08`. This matters because the FX quote is itself 15-minute delayed: BTC spot is live, but its converted value is only as fresh as that rate. Until the rate arrives (`rate loading…`), or if it never does (`rate unavailable — showing USD`), the convertible tiles show honest USD with a `$` prefix rather than a number the app cannot back up.

### 5.7 Today's read (daily commentary panel)

`components/Commentary.tsx`, rendered between the header divider and the first section. On mount it fetches `${import.meta.env.BASE_URL}data/commentary.json` once — a static file on the site's own origin, produced by the CI job in §3.8, so there is no proxy, no key and no polling. The fetch is base-aware so the satusd.com sub-route deploy resolves it correctly.

**Collapsed (default):** one row — `TODAY'S READ — <headline> ▾` — eyebrow micro-type for the label, the headline in body text with an ellipsis if it overflows (wrapping at ≤640px). This is the only vertical cost in the default state, keeping the one-viewport layout of §5.1.

**Expanded (click):** the note's paragraphs in the display serif at 15px (max width 72ch), a compact stats strip — the eight tiles in dashboard order with their week / month / YTD moves (basis points for the two yields, percent for the rest), four per row, two at ≤640px — and a footer line `AI-GENERATED FROM THE DAY'S NUMBERS · AUG 23 · NOT INVESTMENT ADVICE`, with `· MARKETS CLOSED` appended when the note's `tradingDay` is false. The open/closed state persists to `localStorage("mp-commentary-open")` (its own key, not shared with satusd.com).

**Absent note:** if the file 404s or fails to parse (a fresh clone, a fork that has never run the job, a network error), the component renders nothing at all — no placeholder, no reserved space. It also renders nothing until the fetch resolves, so the dashboard never shifts layout for a note that turns out not to exist.

**Stale note:** the job runs every day, weekends included, so a note older than `STALE_AFTER_DAYS` (3) whole UTC days means the pipeline is broken. The row then reads `TODAY'S READ — no commentary since AUG 20` in muted text instead of presenting the old headline as today's; expanding still shows the old note, headed by a red `LAST NOTE IS FROM AUG 20 — THE DAILY JOB HAS NOT RUN SINCE` line. Staleness is computed against the dashboard's 1-second clock, so a tab left open rolls over correctly.

Styling follows the rest of the app: colours via `theme.ts` tokens inline; the `:hover`, the ellipsis and the strip's breakpoint in `styles.css` (`.read-*`).

---

## 6. State Shape

```ts
type Tile = {
  loading: boolean;
  error?: boolean;
  price?: number;
  previousClose?: number;
  history?: number[];
  lastUpdate?: number; // unix ms
};

type DashboardState = {
  copper: Tile;
  brent: Tile;
  tnx: Tile;
  tyx: Tile;
  gold: Tile;
  jpy: Tile;
  dxy: Tile;
  btc: Tile;
  // Display currency, and the selected currency's USD rate. `fx` reuses the
  // tile shape (only `price`, `loading`/`error` and `lastUpdate` are read)
  // and stays untouched for USD, which is the base.
  currency: "USD" | "CAD" | "INR";
  fx: Tile;
};

// Today's read (§5.7) keeps its own state inside components/Commentary.tsx:
// the fetched note (undefined while loading, null when absent) and the
// open/closed flag. Its shape is `Commentary` in src/lib/commentary.ts,
// mirroring the document written by scripts/commentary.mjs (§3.8).
```

Each tile manages its own loading/error state. A failure in one fetch must never propagate to other tiles.

---

## 7. Error Handling

| Failure | Behavior |
|---|---|
| One proxy 403s / 5xx / returns junk | The fetch rotates to the next proxy in the chain (validating JSON per attempt); the tile is unaffected as long as some proxy answers. |
| Whole rotation fails one tick | Fetcher retries the rotation once (~700ms pause). If it still fails, a tile that has loaded before keeps its last good price (with the original `UPD` timestamp signalling staleness); a tile that has never loaded falls back to the persisted quote from a previous session (below), and only shows "fetch failed" in red if there is none. |
| Cold load while every proxy is down | Each Yahoo tile's last good quote is persisted to `localStorage` (`mp-lastgood-<key>`) on every successful fetch and hydrated on mount, so a returning visitor sees honestly-stale prices (old `UPD` timestamps) instead of "fetch failed". Only a first-ever visit with all proxies down shows the error state. |
| CoinGecko rate-limited (429) | BTC tile keeps showing live spot price from Coinbase but sparkline and 24h change stay stale or unavailable. |
| Coinbase fails | BTC tile shows "fetch failed" until next successful poll. |
| Selected currency's FX rate unavailable | The four convertible tiles fall back to displaying USD — with the `$` prefix, so nothing is mislabeled — and the footer reads `USD/CAD rate unavailable — showing USD`. Yields, DXY and USD/JPY are unaffected, as they never convert. |
| Network offline | Already-loaded tiles freeze on their last values (timestamps stop advancing); a tile still mid-first-load shows "fetch failed". No popups, no toasts. |
| `commentary.json` missing / unparsable | The Today's read row does not render at all. Nothing else is affected. |
| Daily commentary job broken (note > 3 days old) | The row reads `no commentary since <date>` and the expanded view flags the last note's date in red; the old text remains readable but is never presented as today's. |

Within a tick the fetcher rotates proxies and retries once; across ticks the 5-minute polling interval is the longer-horizon retry.

---

## 8. Project Structure

```
market-pulse/
├── index.html
├── public/
│   ├── favicon.svg        // shared satusd.com brand mark
│   └── data/
│       ├── snapshots.jsonl  // one line per day, appended by CI (§3.6)
│       ├── commentary.json  // latest LLM-written note (§3.8)
│       └── commentary.jsonl // every note, one per line
├── worker/
│   ├── index.js           // Cloudflare Worker: pinned Yahoo CORS proxy (primary)
│   └── wrangler.toml
├── scripts/
│   ├── snapshot.mjs       // daily snapshot CLI (CI); see §3.6
│   ├── snapshot-lib.mjs   // its pure helpers
│   ├── snapshot.test.mjs  // `npm test`
│   ├── trends.mjs         // pure trend statistics; see §3.7
│   ├── trends.test.mjs
│   ├── stats.mjs          // CLI: history dump + snapshot log → stats pack
│   ├── commentary.mjs     // CLI: stats pack → Claude → commentary.json; see §3.8
│   ├── commentary-lib.mjs // prompt, schema, validation, document shape
│   └── commentary.test.mjs
├── .github/workflows/
│   ├── deploy-satusd.yml  // build + push dist/ into saubyk/satusd.com
│   └── daily-commentary.yml // cron: snapshot → stats → commentary → commit → dispatch deploy
├── package.json
├── tsconfig.json
├── vite.config.ts
├── README.md
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── components/
    │   ├── Tile.tsx
    │   ├── Sparkline.tsx
    │   ├── LiveDot.tsx
    │   ├── ThemeToggle.tsx
    │   └── CurrencyPicker.tsx
    ├── lib/
    │   ├── fetchers.ts        // fetchYahoo, fetchBTCSpot, fetchBTCHistory
    │   ├── format.ts          // fmtUSD, fmtPct, fmtChg, fmtTime
    │   ├── currency.ts        // display currencies, symbols, rate keys
    │   └── theme.ts           // COLORS (var(--…) refs), fonts
    └── styles.css             // theme tokens, resets, font imports, keyframes
```

Keep it flat. No `src/hooks/`, no `src/utils/`, no Redux folder. This is an eight-tile dashboard.

---

## 9. Known Gotchas & Future Mitigations

These are documented for the implementer; they are **not** required in v1.

1. **CORS proxy reliability.** *(Resolved July 2026 — see §3.1.)* The predicted correlated failure happened: corsproxy.io restricted its free tier to localhost/dev origins while allorigins and codetabs were timing out, taking down all five Yahoo tiles in production. The durable fix implemented: a self-hosted Cloudflare Worker as primary (edge-cached, pinned to Yahoo's chart endpoint), public proxies demoted to fallback, plus `localStorage` persistence of last-good quotes so even a total proxy outage renders stale data on cold loads. Remaining risk: Yahoo blocking Cloudflare's IP ranges — then the fallback is a key'd, CORS-native source (gotcha 2).
2. **Yahoo unofficial endpoint.** Has no SLA. If Yahoo adds crumb/cookie requirements (as they have in the past for the v7 endpoint), the v8 chart endpoint may also break. Fallback option: Twelve Data free tier (requires a free API key but sends CORS headers natively).
3. **CoinGecko free tier rate limit.** Polling history once every 5 minutes is well under the limit, but if multiple users open the page in quick succession from the same IP, it can hit the cap. If that becomes an issue, swap to Coinbase historic endpoint: `GET https://api.coinbase.com/v2/prices/BTC-USD/spot?date=YYYY-MM-DD`.
4. **`^TNX` convention change.** The auto-detection in §3.5 should handle both conventions, but if Yahoo ever reports values in the 15–20 range (unlikely but possible during an extreme bond-market dislocation), the heuristic would mis-fire. Worth a comment in the code.

### 9.1 Operating the daily job (§3.6–3.8)

How the commentary pipeline fails, and what is in place for each:

- **The note fails but the snapshot doesn't** (API outage, a refusal that survives the fallback chain, a malformed answer, a missing key on a fork). The `Generate commentary` step is `continue-on-error`; the snapshot still commits and deploys, and a final step re-raises the failure so the run is red. The previous day's `commentary.json` stays live; after `STALE_AFTER_DAYS` (3) the panel says `no commentary since <date>` (§5.7).
- **Who hears about a red run.** GitHub sends scheduled-workflow failure notifications to *the user who last modified the cron line in the workflow file* — so whoever last touched `cron:` in `daily-commentary.yml` owns the alerts. Keep that in mind when editing the schedule from a different account.
- **Cron drift.** GitHub schedules can run late under load and may drop queued runs at the top of the hour; the job runs at :30 for that reason. A dropped run is simply a missing day.
- **Catch-up semantics.** `workflow_dispatch` re-runs *today*: a same-day re-run replaces today's snapshot line and note (upsert by date). There is no backfill — a missed day stays a gap in `snapshots.jsonl`, because the sources only report the current close; the Yahoo history fetched for the stats pack still covers the gap for trend purposes.
- **60-day inactivity rule.** On public repositories GitHub disables scheduled workflows after 60 days without repository activity. The job's own daily commit counts as activity while it runs, so the rule only bites after two months of *consecutive* failures — by which point the stale panel has been red for 57 days. Re-enable from the Actions tab. There is deliberately no separate keepalive.
- **Deploy trigger.** The job pushes with `GITHUB_TOKEN`, which never triggers other workflows, so it dispatches `deploy-satusd.yml` explicitly (allowed for `workflow_dispatch`). `deploy-satusd.yml` also runs `npm test` before building, so a broken `main` is not deployed.
- **Cost.** Measured on the first run: 3,370 input + 638 output tokens on `claude-fable-5` ≈ $0.07/run, ≈ $2/month. `usage` is stored in every `commentary.json` / `.jsonl` line, so actual spend is auditable from the archive: `jq -s 'map(.usage.inputTokens) | add' public/data/commentary.jsonl`.
- **Growth.** `snapshots.jsonl` ≈ 0.7 KB/day (≈ 250 KB/year); `commentary.jsonl` ≈ 5.6 KB/day with the stats block (≈ 2 MB/year). Both ship in `dist/` but the browser only ever fetches `commentary.json` (≈ 10 KB), so the archives cost nothing at page load. No retention policy is needed for years; if one ever is, the stats block in the archive is the first thing to drop.
- **Fork checklist.** Deploy your own worker and set `MP_PROXY_TOKEN` (worker secret + repo secret) for reliable Yahoo access; add `ANTHROPIC_API_KEY` for the note; or leave both unset and the job still records whatever the public proxies return.

---

## 10. Acceptance Criteria

The implementation is done when:

- [ ] Running `npm install && npm run dev` opens a working dashboard with no console errors.
- [ ] All eight tiles render a current price within 10 seconds of page load on a normal connection.
- [ ] BTC price updates visibly within ~8 seconds of a real price move on Coinbase.
- [ ] The 10Y yield tile shows a value between roughly 3 and 6 (i.e. as a percent, not as percent × 10).
- [ ] Killing the network (DevTools offline) within 60 seconds causes the seven Yahoo-backed tiles (Copper, Brent, 10Y, 30Y, Gold, USD/JPY, DXY) to show "fetch failed" and BTC to follow within 8 seconds. Restoring the network restores all tiles within one polling interval.
- [ ] Switching the currency picker to CAD or INR converts exactly the four dollar-priced tiles (BTC, Gold, Copper, Brent) and leaves the yields, DXY and USD/JPY untouched; percent changes are identical across currencies and the footer discloses the rate applied.
- [ ] With a committed `public/data/commentary.json`, the Today's read row shows its headline, expands to the paragraphs, stats strip and AI-generated footer, and adds no height to the dashboard while collapsed; with the file removed the row is absent and the dashboard is otherwise unchanged.
- [ ] `npm run build` produces a static bundle deployable to any static host.
- [ ] The README explains: what it does, what's live vs delayed, the CORS-proxy caveat, and how to run it.

---

## 11. Out of Scope (do not build)

- Backend / server-side rendering.
- API key configuration UI.
- Authentication.
- Watchlist customization.
- Historical charts beyond the sparkline.
- Push notifications / alerts.
- Mobile-*first* layout (desktop-first with a responsive collapse is the approach; the two-column sections fold to a single stacked column at ≤640px via CSS — see §5.1 — but no separate mobile design is maintained).
- OS-preference auto-theming (`prefers-color-scheme`) — the theme is explicit: light default plus a manual toggle, matching satusd.com (see §5.3).
- I18N / locale-aware number formatting (grouping and separators are always en-US).
- Display currencies beyond the USD/CAD/INR of §5.6 — no arbitrary currency list, no currency conversion of the yield, index or FX tiles.
- Commentary features beyond §5.7: no per-tile notes, no history browser for past notes in the UI (the archive is `commentary.jsonl`), no "regenerate" button, no browser-side LLM calls.

---

## 12. Disclaimer (must appear in the UI footer)

> NOT INVESTMENT ADVICE. Prices are delayed by at least 15 minutes for commodities and Treasury yields. Bitcoin spot is sourced from Coinbase. Data sources may rate-limit or fail without notice.
