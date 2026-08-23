# Market Pulse — Specification

A minimal, browser-only dashboard that displays financial instruments side-by-side across four categories — **Energy & Metals** (Copper, Brent crude), **US Treasuries** (10Y, 30Y yields), **Scarce Assets** (Bitcoin, Gold), and **Currencies** (USD/JPY, US Dollar Index). The dollar-priced instruments can be displayed in USD (default), CAD or INR. Designed to run entirely as a static SPA — no backend, no API keys, no auth.

---

## 1. Goals & Non-Goals

### Goals
- Single-page dashboard showing live or near-live prices for the eight instruments above.
- Zero-config setup: clone, install, run. No API keys, no server.
- Honest about data freshness: live where possible, clearly labeled as delayed otherwise.
- Robust to API hiccups: a failed tile must not break the others.
- Optional display of the dollar-priced instruments in CAD or INR, converted at a live-fetched rate that the UI discloses.
- Deployable as static files to Netlify, Vercel, GitHub Pages, or Cloudflare Pages.
- A daily snapshot log of every instrument's close, kept in the repo (§3.6), as the basis for the planned daily commentary.

### Non-Goals
- Historical charting beyond a small sparkline.
- User accounts, watchlists, or per-user persistence.
- Trading, alerts, or notifications.
- Mobile-first layout (desktop-first is fine; should not break on mobile but no special tuning required).
- Real-time tick streaming for non-BTC instruments (free-tier limitation; out of scope).

---

## 2. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Build tool | **Vite** | Fastest cold start, simple static output. |
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
- Reference for change: `result.meta.chartPreviousClose` (fallback: `previousClose`)
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

`node scripts/snapshot.mjs --history-out <file>` additionally dumps the full year of `[unix ms, close]` bars per symbol to a scratch file for the commentary step; that dump is not committed. The pure parts (`scripts/snapshot-lib.mjs`) are covered by `npm test` (Node's built-in runner, no dependency). The job needs no secrets to run; `MP_PROXY_TOKEN` only improves its odds against Yahoo's datacenter-IP blocking.

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
- Header above, source footer below. The eyebrow row carries the satusd.com link, the currency picker (§5.6) and the theme toggle, so neither control costs vertical space.
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

Within a tick the fetcher rotates proxies and retries once; across ticks the 5-minute polling interval is the longer-horizon retry.

---

## 8. Project Structure

```
market-pulse/
├── index.html
├── public/
│   ├── favicon.svg        // shared satusd.com brand mark
│   └── data/
│       └── snapshots.jsonl // one line per day, appended by CI (§3.6)
├── worker/
│   ├── index.js           // Cloudflare Worker: pinned Yahoo CORS proxy (primary)
│   └── wrangler.toml
├── scripts/
│   ├── snapshot.mjs       // daily snapshot CLI (CI); see §3.6
│   ├── snapshot-lib.mjs   // its pure helpers
│   └── snapshot.test.mjs  // `npm test`
├── .github/workflows/
│   ├── deploy-satusd.yml  // build + push dist/ into saubyk/satusd.com
│   └── daily-commentary.yml // cron: scripts/snapshot.mjs → commit → dispatch deploy
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

---

## 10. Acceptance Criteria

The implementation is done when:

- [ ] Running `npm install && npm run dev` opens a working dashboard with no console errors.
- [ ] All eight tiles render a current price within 10 seconds of page load on a normal connection.
- [ ] BTC price updates visibly within ~8 seconds of a real price move on Coinbase.
- [ ] The 10Y yield tile shows a value between roughly 3 and 6 (i.e. as a percent, not as percent × 10).
- [ ] Killing the network (DevTools offline) within 60 seconds causes the seven Yahoo-backed tiles (Copper, Brent, 10Y, 30Y, Gold, USD/JPY, DXY) to show "fetch failed" and BTC to follow within 8 seconds. Restoring the network restores all tiles within one polling interval.
- [ ] Switching the currency picker to CAD or INR converts exactly the four dollar-priced tiles (BTC, Gold, Copper, Brent) and leaves the yields, DXY and USD/JPY untouched; percent changes are identical across currencies and the footer discloses the rate applied.
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

---

## 12. Disclaimer (must appear in the UI footer)

> NOT INVESTMENT ADVICE. Prices are delayed by at least 15 minutes for commodities and Treasury yields. Bitcoin spot is sourced from Coinbase. Data sources may rate-limit or fail without notice.
