# Market Pulse — Specification

A minimal, browser-only dashboard that displays financial instruments side-by-side across three categories — **Energy & Metals** (Copper, Brent crude), **US Treasuries** (10Y, 30Y yields), and **Scarce Assets** (Bitcoin, Gold). Designed to run entirely as a static SPA — no backend, no API keys, no auth.

---

## 1. Goals & Non-Goals

### Goals
- Single-page dashboard showing live or near-live prices for the four instruments above.
- Zero-config setup: clone, install, run. No API keys, no server.
- Honest about data freshness: live where possible, clearly labeled as delayed otherwise.
- Robust to API hiccups: a failed tile must not break the others.
- Deployable as static files to Netlify, Vercel, GitHub Pages, or Cloudflare Pages.

### Non-Goals
- Historical charting beyond a small sparkline.
- User accounts, watchlists, or persistence.
- Trading, alerts, or notifications.
- Mobile-first layout (desktop-first is fine; should not break on mobile but no special tuning required).
- Real-time tick streaming for non-BTC instruments (free-tier limitation; out of scope).

---

## 2. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Build tool | **Vite** | Fastest cold start, simple static output. |
| Framework | **React 18 + TypeScript** | Component model fits the four-tile layout; TS catches the kinds of bugs that show up in API parsing. |
| Styling | **Plain CSS or inline styles** | The design is custom and small; a utility framework is overkill. Tailwind is acceptable if the implementer prefers it. |
| State | **`useState` + `useEffect`** | No global state needed. |
| Charts | **Hand-rolled SVG** | One small sparkline component, ~30 lines. No chart library dependency. |
| HTTP | **Native `fetch`** | No axios, no react-query. |
| Fonts | **Google Fonts**: `Instrument Serif` (display, italic) + `JetBrains Mono` (body, numerics) | |

No backend. No environment variables. No build-time secrets.

---

## 3. Data Sources

All four data sources are free and require no API key. Three of them are reached through a public CORS proxy because the underlying provider does not send `Access-Control-Allow-Origin` headers.

### 3.1 CORS proxy

Define a single constant:

```ts
const PROXY = "https://corsproxy.io/?";
```

Use it as:
```ts
const url = PROXY + encodeURIComponent(originalUrl);
```

**Known risk:** `corsproxy.io` is a free public service. It can rate-limit or go offline. The spec includes a fallback in §9.

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

### 3.4 Copper, Brent, Treasuries, Gold — Yahoo Finance (15-min delayed, via proxy)

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

---

## 4. Polling Strategy

| Instrument | Source | Interval | Rationale |
|---|---|---|---|
| BTC spot | Coinbase | **8 seconds** | True real-time feel. |
| BTC 24h history | CoinGecko | **5 minutes** | Reference for change/sparkline; doesn't need to be fresh. |
| Copper / Brent / 10Y / 30Y / Gold | Yahoo (proxied) | **5 minutes**, staggered ~400ms apart | Data is 15-min delayed anyway; polling faster adds nothing. The stagger keeps the five symbol fetches under the free proxies' per-IP burst threshold. |
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
│  ┌─────────────────────┐ ┌─────────────────────┐        │
│  │ HG=F · COPPER       │ │ BZ=F · BRENT CRUDE  │        │
│  │ $4.521              │ │ $66.84              │        │
│  │ ▲ +0.023  +0.51%    │ │ ▲ +0.31  +0.47%     │        │
│  └─────────────────────┘ └─────────────────────┘        │
│  ┌─────────────────────┐ ┌─────────────────────┐        │
│  │ ^TNX · US 10Y YIELD │ │ BTC-USD · BITCOIN   │        │
│  │ 4.234               │ │ $62,108             │        │
│  │ ▲ +0.012  +0.28%    │ │ ▲ +1,240  +2.03%    │        │
│  └─────────────────────┘ └─────────────────────┘        │
│  ───────────────────────────────────────────            │
│  SOURCES — YAHOO via corsproxy.io · COINBASE · COINGECKO│
└─────────────────────────────────────────────────────────┘
```

- Centered container, max-width ~980px.
- 2×2 grid of tiles, gap ~14px.
- Header above, source footer below.

### 5.2 Tile contents (each tile)

1. **Top row:** ticker label (e.g. `HG=F · COPPER`) on the left, freshness tag on the right (`LIVE` with pulsing dot for BTC, `DLY 15m` muted for others).
2. **Sublabel:** small italic serif description, e.g. "Copper futures, $/lb".
3. **Price:** large monospace, light weight (~300), with currency prefix.
4. **Change row:** arrow + absolute change + percent change, colored green/red. Sparkline aligned to the right of this row.
5. **Footer:** small "UPD HH:MM:SS" timestamp showing last successful fetch.

### 5.3 Design tokens

```ts
const COLORS = {
  bg: "#0c0b09",                                // near-black, warm
  bgGrad: "radial-gradient(ellipse at top, #16140f 0%, #0c0b09 60%)",
  panel: "rgba(255, 250, 235, 0.025)",
  border: "rgba(240, 230, 200, 0.09)",
  text: "#f0ebe0",                              // warm cream
  textDim: "#a8a294",
  muted: "#615c52",
  faint: "#3a3730",
  up: "#8fb877",                                // sage green
  down: "#d97757",                              // terracotta
  amber: "#d4a574",                             // accent / live indicator
};
```

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
  btc: Tile;
};
```

Each tile manages its own loading/error state. A failure in one fetch must never propagate to other tiles.

---

## 7. Error Handling

| Failure | Behavior |
|---|---|
| CORS proxy down / 5xx | The affected tile shows "fetch failed" in red instead of a price. Other tiles unaffected. Polling continues (next interval retries automatically). |
| Yahoo returns no `result` | Same as above. |
| CoinGecko rate-limited (429) | BTC tile keeps showing live spot price from Coinbase but sparkline and 24h change stay stale or unavailable. |
| Coinbase fails | BTC tile shows "fetch failed" until next successful poll. |
| Network offline | All tiles show "fetch failed" within one polling interval. No popups, no toasts. |

No retry-with-backoff logic is required — the polling interval itself acts as the retry.

---

## 8. Project Structure

```
market-pulse/
├── index.html
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
    │   └── LiveDot.tsx
    ├── lib/
    │   ├── fetchers.ts        // fetchYahoo, fetchBTCSpot, fetchBTCHistory
    │   ├── format.ts          // fmtUSD, fmtPct, fmtChg, fmtTime
    │   └── theme.ts           // COLORS, fonts
    └── styles.css             // global resets, font imports, keyframes
```

Keep it flat. No `src/hooks/`, no `src/utils/`, no Redux folder. This is a four-tile dashboard.

---

## 9. Known Gotchas & Future Mitigations

These are documented for the implementer; they are **not** required in v1.

1. **CORS proxy single point of failure.** If `corsproxy.io` becomes unreliable, swap to `https://api.allorigins.win/raw?url={ENCODED}` by changing one constant. A v2 could try the primary, fall back to secondary on error.
2. **Yahoo unofficial endpoint.** Has no SLA. If Yahoo adds crumb/cookie requirements (as they have in the past for the v7 endpoint), the v8 chart endpoint may also break. Fallback option: Twelve Data free tier (requires a free API key but sends CORS headers natively).
3. **CoinGecko free tier rate limit.** Polling history once every 5 minutes is well under the limit, but if multiple users open the page in quick succession from the same IP, it can hit the cap. If that becomes an issue, swap to Coinbase historic endpoint: `GET https://api.coinbase.com/v2/prices/BTC-USD/spot?date=YYYY-MM-DD`.
4. **`^TNX` convention change.** The auto-detection in §3.5 should handle both conventions, but if Yahoo ever reports values in the 15–20 range (unlikely but possible during an extreme bond-market dislocation), the heuristic would mis-fire. Worth a comment in the code.

---

## 10. Acceptance Criteria

The implementation is done when:

- [ ] Running `npm install && npm run dev` opens a working dashboard with no console errors.
- [ ] All four tiles render a current price within 10 seconds of page load on a normal connection.
- [ ] BTC price updates visibly within ~8 seconds of a real price move on Coinbase.
- [ ] The 10Y yield tile shows a value between roughly 3 and 6 (i.e. as a percent, not as percent × 10).
- [ ] Killing the network (DevTools offline) within 60 seconds causes the three Yahoo-backed tiles to show "fetch failed" and BTC to follow within 8 seconds. Restoring the network restores all tiles within one polling interval.
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
- Mobile-specific layout (the 2×2 grid collapsing to 1×4 on narrow viewports is acceptable but not required).
- Dark/light mode toggle (dark only).
- I18N / currency conversion.

---

## 12. Disclaimer (must appear in the UI footer)

> NOT INVESTMENT ADVICE. Prices are delayed by at least 15 minutes for commodities and Treasury yields. Bitcoin spot is sourced from Coinbase. Data sources may rate-limit or fail without notice.
