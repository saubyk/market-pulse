# Market Pulse

A zero-config, browser-only dashboard showing four financial instruments side by side:

| Instrument | Source | Freshness |
|---|---|---|
| WTI Crude (`CL=F`) | Yahoo Finance (via `corsproxy.io`) | ~15 min delayed |
| Brent Crude (`BZ=F`) | Yahoo Finance (via `corsproxy.io`) | ~15 min delayed |
| US 10Y Yield (`^TNX`) | Yahoo Finance (via `corsproxy.io`) | ~15 min delayed |
| Bitcoin (`BTC-USD`) | Coinbase spot + CoinGecko 24h history | **Live** (8s polling) |

No backend, no API keys, no auth. Deploys as static files to Netlify, Vercel, GitHub Pages, or Cloudflare Pages.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static bundle in dist/
npm run preview  # serve dist/
```

## Live vs delayed

Bitcoin is fetched directly from Coinbase's public spot endpoint (CORS-enabled) and refreshes every 8 seconds. The 24-hour reference price and sparkline for BTC come from CoinGecko, refreshed every 5 minutes.

WTI, Brent, and the 10-year yield come from Yahoo Finance's unofficial chart endpoint. Yahoo does not send `Access-Control-Allow-Origin`, so the request is proxied through `corsproxy.io`. The data is 15-minute delayed, polled once a minute.

## CORS proxy caveat

`corsproxy.io` is a free public service. It can rate-limit, slow down, or go offline without notice. If it does, the three Yahoo-backed tiles will show "fetch failed" and retry on the next polling tick. To swap proxies, change one constant in `src/lib/fetchers.ts`:

```ts
const PROXY = "https://api.allorigins.win/raw?url=";
```

(See `SPEC.md` §9 for other contingencies.)

## Error handling

Each tile manages its own loading and error state. A failure in one fetch never affects another tile. There is no retry/backoff — the polling interval is the retry. Disconnecting the network causes tiles to show "fetch failed" within their poll interval; reconnecting restores them on the next tick.

## Layout

- Centered, max-width 980px
- 2×2 tile grid
- Header (clock + date), source/disclaimer footer
- Aesthetic target: refined Bloomberg terminal, not crypto-bro dashboard

## Disclaimer

Not investment advice. Prices are delayed by at least 15 minutes for crude oil and Treasury yields. Bitcoin spot is sourced from Coinbase. Data sources may rate-limit or fail without notice.
