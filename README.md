# Market Pulse

A zero-config, browser-only dashboard showing six financial instruments organized into three categories:

![Market Pulse dashboard](docs/screenshot.png)

| Category | Instrument | Source | Freshness |
|---|---|---|---|
| **Scarce Assets** | Bitcoin (`BTC-USD`) | Coinbase spot + CoinGecko 24h history | **Live** (8s polling) |
| **Scarce Assets** | Gold (`GC=F`) | Yahoo Finance (via `corsproxy.io`) | ~15 min delayed |
| **Energy & Metals** | Copper (`HG=F`) | Yahoo Finance (via `corsproxy.io`) | ~15 min delayed |
| **Energy & Metals** | Brent Crude (`BZ=F`) | Yahoo Finance (via `corsproxy.io`) | ~15 min delayed |
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

Copper, Brent crude, Treasury yields (10Y/30Y), and gold come from Yahoo Finance's unofficial chart endpoint. Yahoo does not send `Access-Control-Allow-Origin`, so the request is proxied. The data is 15-minute delayed, so each symbol is polled every 5 minutes and the five fetches are staggered ~400ms apart to stay under the free proxies' per-IP burst limits.

## CORS proxy caveat

Yahoo sends no CORS headers and increasingly blocks datacenter IPs, so no single free proxy is reliable: `corsproxy.io` 403s server-side requests, `api.allorigins.win/raw` is valid but often slow (10–20s) or 5xx, and `api.codetabs.com` gets throttled by Yahoo's edge. Resilience therefore comes from layering, not any one proxy:

- **Rotation** — each request tries the three proxies in order, validating the JSON *inside* the loop so a proxy that answers `200` with junk (an HTML interstitial, "Edge: Too Many Requests") falls through to the next instead of poisoning the tile.
- **Per-attempt timeout** — each proxy attempt is capped at 8s (`AbortController`) so one stalled proxy can't hold up the tick.
- **Retry** — if a full rotation fails, the fetcher pauses ~700ms and runs the rotation once more, which clears most transient single-tick failures.

To change the chain (add more, reorder, or pin to one), edit the `PROXIES` array in `src/lib/fetchers.ts`. The rotation lives in `fetchYahooOnce`; the retry wrapper is `fetchYahoo`.

(See `SPEC.md` §9 for other contingencies — Yahoo crumb/cookie requirements, CoinGecko rate limits, etc.)

## Error handling

Each tile manages its own loading and error state. A failure in one fetch never affects another tile. When a Yahoo tile that has already loaded hits a transient failure, it keeps showing its last good price — the `UPD` timestamp reveals how stale it is — rather than blanking to "fetch failed". Only a tile that has *never* loaded shows the error state. Disconnecting the network keeps the last values frozen (timestamps stop advancing); reconnecting refreshes them on the next successful tick.

## Layout

- Centered, max-width 980px
- 3 categorized sections (Energy & Metals, US Treasuries, Scarce Assets), 2 tiles each
- Header (clock + date + theme toggle), source/disclaimer footer
- **Responsive:** each section is a two-column grid on desktop that collapses to a single stacked column at ≤640px; page/tile padding tightens and the title scales fluidly (`clamp`) so it reads cleanly down to ~320px. The breakpoint lives in `src/styles.css` (`.tile-grid`, `.app-shell`, `.tile`).
- Aesthetic target: refined Bloomberg terminal, not crypto-bro dashboard

## Theming

Light by default, dark via the moon/sun toggle in the header. The palette is shared with [satusd.com](https://satusd.com/) — the tokens live as CSS custom properties in `src/styles.css` (`:root` light, `:root[data-theme="dark"]` dark). The choice persists in `localStorage` under the `theme` key, the same one satusd.com uses, so when the dashboard is served at `satusd.com/market-pulse` the preference carries across both pages. An inline script in `index.html` applies the saved theme before first paint to avoid a flash. OS `prefers-color-scheme` is deliberately ignored, matching satusd.com.

## Deploying as a sub-route

By default, `npm run build` produces a root-relative bundle that drops onto any static host (Netlify, Vercel, GitHub Pages, Cloudflare Pages) and works at the domain root.

If you need to serve the dashboard from a sub-path instead — e.g. `example.com/market-pulse/` — use:

```bash
npm run build:satusd
```

That builds with Vite's `--base=/market-pulse/` so asset URLs resolve under the sub-path. Copy the resulting `dist/` into your host's `market-pulse/` directory.

This repo also ships a `.github/workflows/deploy-satusd.yml` Action that builds and pushes the output to `saubyk/satusd.com`. It is specific to the satusd.com deploy and is irrelevant to other forks — feel free to delete it if you're using market-pulse elsewhere.

## Disclaimer

Not investment advice. Prices are delayed by at least 15 minutes for commodities and Treasury yields. Bitcoin spot is sourced from Coinbase. Data sources may rate-limit or fail without notice.
