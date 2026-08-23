# Market Pulse

A zero-config, browser-only dashboard showing eight financial instruments organized into four categories:

![Market Pulse dashboard](docs/screenshot.png)

| Category | Instrument | Source | Freshness |
|---|---|---|---|
| **Scarce Assets** | Bitcoin (`BTC-USD`) | Coinbase spot + CoinGecko 24h history | **Live** (8s polling) |
| **Scarce Assets** | Gold (`GC=F`) | Yahoo Finance (proxied) | ~15 min delayed |
| **Energy & Metals** | Copper (`HG=F`) | Yahoo Finance (proxied) | ~15 min delayed |
| **Energy & Metals** | Brent Crude (`BZ=F`) | Yahoo Finance (proxied) | ~15 min delayed |
| **US Treasuries** | US 10Y Yield (`^TNX`) | Yahoo Finance (proxied) | ~15 min delayed |
| **US Treasuries** | US 30Y Yield (`^TYX`) | Yahoo Finance (proxied) | ~15 min delayed |
| **Currencies** | USD/JPY (`JPY=X`) | Yahoo Finance (proxied) | ~15 min delayed |
| **Currencies** | US Dollar Index (`DX-Y.NYB`) | Yahoo Finance (proxied) | ~15 min delayed |

Prices for the four dollar-priced instruments (Bitcoin, gold, copper, Brent) can be shown in **USD, CAD or INR** — see [Currency](#currency).

No backend, no API keys, no auth. Deploys as static files to Netlify, Vercel, GitHub Pages, or Cloudflare Pages.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static bundle in dist/
npm run preview  # serve dist/
npm test         # unit tests for the snapshot script (Node's built-in runner)
```

## Live vs delayed

Bitcoin is fetched directly from Coinbase's public spot endpoint (CORS-enabled) and refreshes every 8 seconds. The 24-hour reference price and sparkline for BTC come from CoinGecko, refreshed every 5 minutes.

Copper, Brent crude, Treasury yields (10Y/30Y), gold, USD/JPY, and the US Dollar Index come from Yahoo Finance's unofficial chart endpoint. Yahoo does not send `Access-Control-Allow-Origin`, so the request is proxied. The data is 15-minute delayed, so each symbol is polled every 5 minutes and the seven fetches are staggered ~400ms apart to stay under the free proxies' per-IP burst limits.

## Currency

The header carries a `USD · CAD · INR` picker. It converts exactly the four instruments that are dollar amounts — Bitcoin, gold, copper and Brent — including their absolute change and the unit in their sublabel (`$/oz` → `C$/oz`). The other four tiles never convert: the 10Y and 30Y yields are percentages, the Dollar Index is a unitless index, and USD/JPY is itself a USD pair. Percent changes are identical in every currency, by definition.

The rate comes from Yahoo (`CAD=X` / `INR=X`) on the same 5-minute poll and through the same proxy rotation as the tiles, and only the selected currency's rate is fetched — USD is the base, so the default view issues no extra request. Conversion happens at render time: quotes are fetched and cached in USD, so switching currency never disturbs a poll loop or a stored last-good value.

Because that FX quote is *itself* 15-minute delayed, the footer names the rate actually applied (`FX USD/CAD 1.3764 · UPD 14:32:08`) — Bitcoin's spot price is live, but its converted value is only as fresh as the rate. If the rate hasn't arrived yet, or can't be fetched at all, the tiles show honest USD with a `$` prefix and the footer says so rather than displaying a number the app can't back up. The choice persists in `localStorage` under `mp-currency`.

## CORS proxy caveat

Yahoo sends no CORS headers, so its requests must be proxied. The primary proxy is a **self-hosted Cloudflare Worker** (source and one-command deploy in `worker/`): it forwards only Yahoo's v8 chart endpoint, adds CORS headers, and caches responses at the edge for 2 minutes so all visitors share one Yahoo fetch per symbol. The free Workers tier (100k requests/day) is far more than this dashboard can use.

The deployed worker is **origin-locked**: it answers requests from satusd.com and from localhost (so `npm run dev` of any clone gets the fast path), and 403s everything else. A *deployed* fork therefore falls through to the public proxies until you deploy your own worker (below) — edit `ALLOWED_ORIGINS` in `worker/index.js` to your own domain.

The free public proxies remain in the rotation as fallback, so a fresh clone works without deploying anything — but don't count on them alone: `corsproxy.io`'s free tier now serves **only localhost/dev origins** (it 403s in production as of mid-2026), `api.allorigins.win/raw` is valid but often slow (10–20s) or 5xx, and `api.codetabs.com` gets throttled by Yahoo's edge. Resilience comes from layering:

- **Rotation** — each request tries the proxies in order (worker first), validating the JSON *inside* the loop so a proxy that answers `200` with junk (an HTML interstitial, "Edge: Too Many Requests") falls through to the next instead of poisoning the tile.
- **Per-attempt timeout** — each proxy attempt is capped at 8s (`AbortController`) so one stalled proxy can't hold up the tick.
- **Retry** — if a full rotation fails, the fetcher pauses ~700ms and runs the rotation once more, which clears most transient single-tick failures.

**Deploying your own worker** (recommended for forks): `cd worker && npx wrangler deploy` (needs a free Cloudflare account), then replace the first entry of the `PROXIES` array in `src/lib/fetchers.ts` with your worker's URL plus `/?url=`. The rotation lives in `fetchYahooOnce`; the retry wrapper is `fetchYahoo`.

The worker also accepts non-browser requests (no `Origin`) that carry an `X-MP-Token` header matching its `MP_PROXY_TOKEN` secret — used only by the daily snapshot job below. `npx wrangler secret put MP_PROXY_TOKEN` enables it; leaving the secret unset turns the path off.

## Daily snapshot log

Independently of the live dashboard, a GitHub Action (`.github/workflows/daily-commentary.yml`) runs `scripts/snapshot.mjs` once a day after the US close and appends one JSON line — every instrument's close, previous close and timestamp, plus BTC spot and its 24h reference — to `public/data/snapshots.jsonl`, then commits it and triggers the satusd.com deploy. Re-running on the same day replaces that day's line rather than duplicating it. The dashboard's own fetching (and the 30-day sparkline) is untouched; this log is the raw material for the daily commentary planned in [issue #6](https://github.com/saubyk/market-pulse/issues/6).

Run it by hand with `node scripts/snapshot.mjs` (add `--history-out file.json` to also dump a year of daily closes per symbol). It tries Yahoo directly, then the worker with `MP_PROXY_TOKEN` if that env var is set (GitHub's runner IPs are often blocked by Yahoo, so forks that want reliable snapshots should deploy their own worker and add the token as a repo secret of the same name), then the public proxies. A day where some sources fail is still recorded, with the failed keys listed under `errors`.

(See `SPEC.md` §9 for other contingencies — Yahoo crumb/cookie requirements, CoinGecko rate limits, etc.)

## Error handling

Each tile manages its own loading and error state. A failure in one fetch never affects another tile. When a Yahoo tile that has already loaded hits a transient failure, it keeps showing its last good price — the `UPD` timestamp reveals how stale it is — rather than blanking to "fetch failed". Only a tile that has *never* loaded shows the error state. Disconnecting the network keeps the last values frozen (timestamps stop advancing); reconnecting refreshes them on the next successful tick.

The last good quote for each Yahoo tile is also persisted to `localStorage`, so on a cold page load the tiles immediately show the previous session's prices (honestly stale, per their `UPD` timestamps) while the first fetch is in flight — and a visitor only ever sees "fetch failed" if every proxy fails on a browser that has never successfully loaded that tile.

## Layout

- Centered, max-width 980px; sections always stack, so desktop shows at most two tiles per row
- 4 categorized sections (Scarce Assets, Energy & Metals, US Treasuries, Currencies), 2 tiles each, compact enough that the whole dashboard fits one desktop viewport height without scrolling
- Header (clock + date + currency picker + theme toggle), source/disclaimer footer
- **Responsive:** each section is a two-column grid that collapses to a single stacked column at ≤640px (page/tile padding tightens, the title scales fluidly with `clamp`, readable down to ~320px). Sections stack vertically at every width, so desktop never shows more than two tiles per row. The breakpoint lives in `src/styles.css` (`.tile-grid`, `.app-shell`, `.app-frame`, `.tile`).
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
