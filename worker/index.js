// Pinned CORS proxy for market-pulse's Yahoo Finance fetches.
//
// Not an open proxy: only Yahoo's v8 chart endpoint is forwarded — any other
// target is rejected — and only browser requests from the allowed origins
// (the deployed dashboard, plus localhost dev) or token-bearing requests
// from the daily snapshot job are answered. Responses are
// cached at the Cloudflare edge for CACHE_TTL_S, so however many visitors
// the dashboard has, Yahoo sees at most one request per symbol per TTL
// window per edge location.
//
// Deploy (one-time, from this directory):
//   npx wrangler deploy
// then put the printed workers.dev URL (plus "/?url=") first in the PROXIES
// array in src/lib/fetchers.ts.

const ALLOWED_PREFIX = "https://query1.finance.yahoo.com/v8/finance/chart/";
const CACHE_TTL_S = 120;

// Origin lock: only the deployed dashboard and local dev may use this
// worker. Forks of market-pulse get a fast 403 here and fall through to
// the public proxies in the rotation (or deploy their own worker — see
// the README). Browsers can't spoof Origin, which is the freeloading
// vector this guards against; it is not a security boundary for
// non-browser clients.
const ALLOWED_ORIGINS = new Set([
  "https://satusd.com",
  "https://www.satusd.com",
]);

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  // Local dev of any clone — harmless, mirrors corsproxy.io's policy.
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

// Server-to-server path for the daily snapshot job (scripts/snapshot.mjs,
// run from GitHub Actions, whose datacenter IPs Yahoo tends to block).
// Non-browser callers send no Origin; instead they must present the
// MP_PROXY_TOKEN secret in an X-MP-Token header. Unset secret = path off.
//   npx wrangler secret put MP_PROXY_TOKEN
async function hasValidToken(request, env) {
  const expected = env.MP_PROXY_TOKEN;
  const given = request.headers.get("X-MP-Token");
  if (!expected || !given) return false;
  const enc = new TextEncoder();
  const a = enc.encode(expected);
  const b = enc.encode(given);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

function corsHeaders(origin) {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    Vary: "Origin",
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const allowed =
      isAllowedOrigin(origin) ||
      (!origin && (await hasValidToken(request, env)));
    if (!allowed) {
      return new Response("origin not allowed", { status: 403 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }
    if (request.method !== "GET") {
      return new Response("method not allowed", {
        status: 405,
        headers: corsHeaders(origin),
      });
    }

    const target = new URL(request.url).searchParams.get("url");
    if (!target || !target.startsWith(ALLOWED_PREFIX)) {
      return new Response("target must be a Yahoo v8 chart URL", {
        status: 400,
        headers: corsHeaders(origin),
      });
    }

    const upstream = await fetch(target, {
      headers: {
        // Yahoo's edge throttles obviously-non-browser clients harder.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "application/json",
      },
      cf: { cacheTtl: CACHE_TTL_S, cacheEverything: true },
    });

    const headers = new Headers(corsHeaders(origin));
    headers.set(
      "Content-Type",
      upstream.headers.get("Content-Type") ?? "application/json",
    );
    headers.set("Cache-Control", `public, max-age=${CACHE_TTL_S}`);
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  },
};
