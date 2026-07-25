// Pinned CORS proxy for market-pulse's Yahoo Finance fetches.
//
// Not an open proxy: only Yahoo's v8 chart endpoint is forwarded — any other
// target is rejected. Responses are cached at the Cloudflare edge for
// CACHE_TTL_S, so however many visitors the dashboard has, Yahoo sees at most
// one request per symbol per TTL window per edge location.
//
// Deploy (one-time, from this directory):
//   npx wrangler deploy
// then put the printed workers.dev URL (plus "/?url=") first in the PROXIES
// array in src/lib/fetchers.ts.

const ALLOWED_PREFIX = "https://query1.finance.yahoo.com/v8/finance/chart/";
const CACHE_TTL_S = 120;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (request.method !== "GET") {
      return new Response("method not allowed", {
        status: 405,
        headers: CORS_HEADERS,
      });
    }

    const target = new URL(request.url).searchParams.get("url");
    if (!target || !target.startsWith(ALLOWED_PREFIX)) {
      return new Response("target must be a Yahoo v8 chart URL", {
        status: 400,
        headers: CORS_HEADERS,
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

    const headers = new Headers(CORS_HEADERS);
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
