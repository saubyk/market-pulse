# Market Pulse

A zero-config, browser-only dashboard showing six financial instruments organized into three categories:

![Market Pulse dashboard](docs/screenshot.png)

| Category | Instrument | Source | Freshness |
|---|---|---|---|
| **Scarce Assets** | Bitcoin (`BTC-USD`) | Coinbase spot + CoinGecko 24h history | **Live** (8s polling) |
| **Scarce Assets** | Gold (`GC=F`) | Yahoo Finance (via `corsproxy.io`) | ~15 min delayed |
| **Crude** | WTI Crude (`CL=F`) | Yahoo Finance (via `corsproxy.io`) | ~15 min delayed |
| **Crude** | Brent Crude (`BZ=F`) | Yahoo Finance (via `corsproxy.io`) | ~15 min delayed |
| **US Treasuries** | US 10Y Yield (`^TNX`) | Yahoo Finance (via `corsproxy.io`) | ~15 min delayed |
| **US Treasuries** | US 30Y Yield (`^TYX`) | Yahoo Finance (via `corsproxy.io`) | ~15 min delayed |

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

Crude (WTI/Brent), Treasury yields (10Y/30Y), and gold come from Yahoo Finance's unofficial chart endpoint. Yahoo does not send `Access-Control-Allow-Origin`, so the request is proxied. The data is 15-minute delayed, so each symbol is polled every 5 minutes and the five fetches are staggered ~400ms apart to stay under the free proxies' per-IP burst limits.

## CORS proxy caveat

Yahoo requests fall through a chain of free public CORS proxies — `corsproxy.io` first, then `api.allorigins.win/raw`. On any non-2xx response or network error from the primary, the fetcher transparently retries via the secondary in the same poll tick. Only if both fail does the tile show "fetch failed", and the next polling tick will retry the whole chain.

To change the chain (add more, reorder, or pin to one), edit the `PROXIES` array in `src/lib/fetchers.ts`. The fetch logic is in `fetchProxied`.

(See `SPEC.md` §9 for other contingencies — Yahoo crumb/cookie requirements, CoinGecko rate limits, etc.)

## Error handling

Each tile manages its own loading and error state. A failure in one fetch never affects another tile. There is no retry/backoff — the polling interval is the retry. Disconnecting the network causes tiles to show "fetch failed" within their poll interval; reconnecting restores them on the next tick.

## Layout

- Centered, max-width 980px
- 3 categorized sections (Crude, US Treasuries, Scarce Assets), 2 tiles each
- Header (clock + date), source/disclaimer footer
- Aesthetic target: refined Bloomberg terminal, not crypto-bro dashboard

## Deploying as a sub-route

By default, `npm run build` produces a root-relative bundle that drops onto any static host (Netlify, Vercel, GitHub Pages, Cloudflare Pages) and works at the domain root.

If you need to serve the dashboard from a sub-path instead — e.g. `example.com/market-pulse/` — use:

```bash
npm run build:satusd
```

That builds with Vite's `--base=/market-pulse/` so asset URLs resolve under the sub-path. Copy the resulting `dist/` into your host's `market-pulse/` directory.

This repo also ships a `.github/workflows/deploy-satusd.yml` Action that builds and pushes the output to `saubyk/satusd.com`. It is specific to the satusd.com deploy and is irrelevant to other forks — feel free to delete it if you're using market-pulse elsewhere.

## Disclaimer

Not investment advice. Prices are delayed by at least 15 minutes for crude oil and Treasury yields. Bitcoin spot is sourced from Coinbase. Data sources may rate-limit or fail without notice.
