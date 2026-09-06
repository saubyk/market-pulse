# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev           # dev server at http://localhost:5173
npm run build         # tsc -b + vite build → root-relative static bundle in dist/
npm run build:satusd  # same build with --base=/market-pulse/ (satusd.com sub-route deploy only)
npm run preview       # serve dist/
npm test              # node --test over scripts/*.test.mjs and src/lib/*.test.ts (needs Node 22+)
```

There is no linter; `npm run build` (which runs `tsc -b`) is the type check. `npm test` is Node's built-in runner over the pure CI-script modules in `scripts/` (`snapshot-lib.mjs`, `trends.mjs`, `commentary-lib.mjs`) and the pure parts of `src/lib/` (`*.test.ts`, run through Node's type stripping — keep tested modules free of enums/namespaces/parameter properties, and import siblings with the `.ts` extension in test files). Components have no tests. `scripts/` is plain ESM JavaScript; don't add TypeScript there. Both workflows run `npm test` on Node 22.

The Yahoo CORS proxy worker deploys separately (not part of any CI): `cd worker && npx wrangler deploy`. Test it locally with `npx wrangler dev` (no Cloudflare auth needed).

## Hard constraints

- **Stay clone-and-run.** `npm install && npm run dev`/`npm run build` must work with no config edits, no API keys, no env vars. The default build must stay root-relative — never set Vite's `base` in `vite.config.ts`. The satusd.com integration is opt-in via `build:satusd` (see Deployment).
- **SPEC.md is the source of truth** for behavior, data sources, design tokens, and scope (§11 lists what not to build). When a change alters behavior, update SPEC.md and README.md in the same commit — past commits deliberately keep them reconciled.
- **Keep it flat and dependency-free.** React + Vite only: no chart libraries, no axios/react-query, no state management, no `src/hooks/` or `src/utils/` directories. Sparkline is hand-rolled SVG. The one exception is `@anthropic-ai/sdk`, a devDependency used solely by `scripts/commentary.mjs` in CI — it must never be imported from `src/`.

## Deployment

**Pushing to `main` is a production deploy.** `.github/workflows/deploy-satusd.yml` fires on every push to `main` (and via manual `workflow_dispatch`): it runs `npm run build:satusd` and commits the resulting `dist/` into the `saubyk/satusd.com` repo under `market-pulse/`, where it goes live at satusd.com/market-pulse. It authenticates with the `SATUSD_DEPLOY_TOKEN` repo secret (a fine-grained PAT with write access to `saubyk/satusd.com` — setup steps are in the workflow's header comment). So don't push half-finished work to `main`; verify the build locally first.

There is no deploy step for the standalone flavor: `npm run build` produces a root-relative `dist/` that drops onto any static host (Netlify, Vercel, GitHub Pages, Cloudflare Pages).

The Cloudflare Worker in `worker/` is deployed manually (`npx wrangler deploy`), not by CI — editing `worker/index.js` does nothing in production until someone redeploys it.

`.github/workflows/daily-commentary.yml` runs `scripts/snapshot.mjs` daily (cron 21:30 UTC), commits `public/data/` to `main`, and then dispatches `deploy-satusd.yml` explicitly — pushes made with `GITHUB_TOKEN` never trigger other workflows. The script reaches Yahoo through the worker's token path (`X-MP-Token` = `MP_PROXY_TOKEN` secret, set both on the worker and in the repo). `scripts/stats.mjs` (pure logic in `scripts/trends.mjs`, SPEC §3.7) turns the snapshot's history dump + the log into the stats pack, and `scripts/commentary.mjs` (SPEC §3.8) sends it to `claude-fable-5` — no `thinking` param (always on for Fable 5), `effort: high`, JSON-schema output, refusal fallbacks on — writing `public/data/commentary.json` + `.jsonl`. It needs the `ANTHROPIC_API_KEY` repo secret and skips cleanly without it. That step is `continue-on-error`: a failed note must never cost the day's snapshot — the commit and deploy still happen, and a final step re-raises the failure. Operating notes (notifications go to whoever last edited the `cron:` line, no backfill, 60-day rule, cost, growth) are in SPEC.md §9.1. The system prompt in `commentary-lib.mjs` is frozen for prompt caching: never interpolate dates or run-specific values into it. This pipeline must never change the dashboard's own fetching (`src/lib/fetchers.ts`, `range=1mo`, 30-day sparkline); see SPEC.md §3.6 and issue #6 for the plan it belongs to.

## Architecture

Static SPA, no backend. Eight tiles (BTC, Gold, Copper, Brent, 10Y, 30Y, USD/JPY, DXY) in four sections. All state lives in `src/App.tsx` as one `useState<TileState>` per tile; each tile's fetch loop is fully independent so one failure never touches another tile. The only other stateful piece is `components/Commentary.tsx` ("Today's read", SPEC §5.7): it fetches `public/data/commentary.json` from the site's own origin via `import.meta.env.BASE_URL`, renders nothing when the file is absent, and flags notes older than 3 days as stale. When the local note is not today's it also fetches the upstream copy (`COMMENTARY_REMOTE_URL`, raw.githubusercontent.com, CORS-open) and shows the newer of the two, re-checking hourly — that is what keeps a self-hosted checkout current (issue #9); an absent local file must still mean no panel. It must stay collapsed by default — the one-viewport layout budget allows it exactly one row.

**Data flow** (`src/lib/fetchers.ts` → `App.tsx` → `components/Tile.tsx`):

- **Yahoo tiles** (Copper, Brent, 10Y, 30Y, Gold, USD/JPY, DXY): `useYahooPoll` in `App.tsx` polls every 5 min. Fetch start times are staggered 400ms apart (the `staggerSlot` arg) to stay under the free CORS proxies' per-IP burst limits.
- **BTC** merges two independent sources: Coinbase spot (direct, CORS-enabled, 8s poll) and CoinGecko 24h history (5 min poll) for the sparkline/change. Either can fail without breaking the other half of the tile.

**Yahoo resilience layering** — Yahoo sends no CORS headers, so requests go through a proxy rotation (`PROXIES` in `fetchers.ts`): a self-hosted Cloudflare Worker first (source in `worker/` — pinned to Yahoo's chart endpoint, origin-locked to satusd.com + localhost via `ALLOWED_ORIGINS`, 120s edge cache), then the free public proxies as fallback. The worker is optional infrastructure: the app must keep working on the fallbacks when it's unreachable (this is what preserves clone-and-run). Note corsproxy.io's free tier serves only localhost/dev origins — it works in `npm run dev` but 403s in production. `fetchYahooOnce` walks the rotation with an 8s `AbortController` timeout per attempt and validates the parsed JSON *inside* the loop (a proxy can answer 200 with an HTML interstitial); `fetchYahoo` retries the whole rotation once after ~700ms. Any change to fetching must preserve all these layers.

**Last-good-value behavior**: on a transient failure, a Yahoo tile that has loaded before re-shows its last good quote (kept in a `useRef` in `useYahooPoll`) with its original `UPD` timestamp — it must not blank to "fetch failed". Each successful fetch is also persisted to `localStorage` (`mp-lastgood-<key>`) and hydrated on mount, so cold loads show the previous session's stale prices while fetching. The error state is only for a tile with no data from any source, ever.

**`^TNX`/`^TYX` quirk**: Yahoo reports yields either as percent (4.53) or percent×10 (45.3). `parseYahoo` divides price, previousClose, and history by 10 whenever the raw price is > 20. Don't remove this heuristic.

**Change reference**: `parseYahoo` derives `previousClose` from the bars (last close on an earlier UTC day than `regularMarketTime`), never from `meta.chartPreviousClose`, which is the close before the *range* — using it made the change row a month-over-month move (#7). Covered by `src/lib/fetchers.test.ts`.

## Styling & theming

Two themes (light default, dark opt-in), implemented as CSS custom properties in `src/styles.css` — `:root` is light, `:root[data-theme="dark"]` is dark (token table in SPEC.md §5.3). Surface/text/accent values are adopted verbatim from satusd.com's `style.css` (the `saubyk/satusd.com` repo) — keep the two files in sync when adjusting either. `src/lib/theme.ts` exports the tokens as `var(--…)` strings so inline styles theme-switch automatically; SVG colors must be applied via `style`, because presentation attributes don't resolve `var()`. Theme is resolved pre-paint by an inline script in `index.html` from `localStorage("theme")` — the same key satusd.com uses, so the preference is shared on the sub-route deploy; `ThemeToggle` flips `data-theme` on `<html>` and the `theme-color` meta. Two accent tiers: `--accent` is decorative-only (LIVE dot), `--accent-text` is contrast-safe for text in light mode.

Components use inline styles, **except** anything responsive or theme-state-dependent (like the toggle's icon swap): inline styles outrank media queries, so the ≤640px collapse lives in CSS classes (`.tile-grid`, `.app-shell`, `.app-frame`, `.section-box`, `.tile`) in `src/styles.css`. Sections stack vertically at every width — desktop shows at most two tiles per row by design. Put any new breakpoint-dependent styling there, not inline.
