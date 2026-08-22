// Yahoo has no CORS headers and increasingly blocks datacenter IPs, so
// every request goes through a proxy rotation with per-attempt timeouts,
// in-loop payload validation, and a full-rotation retry (see fetchYahoo).
//
// The primary is a self-hosted Cloudflare Worker pinned to Yahoo's chart
// endpoint (source + one-command deploy in worker/): fast, CORS-native,
// and edge-cached so all visitors share one Yahoo fetch per symbol. It is
// origin-locked to satusd.com and localhost — local dev of any clone gets
// the fast path, but a *deployed* fork 403s here instantly and falls
// through to the public proxies below (or deploy your own worker and
// swap this first entry; see README). Of the public set: corsproxy.io's
// free tier serves only localhost/dev origins (in production it 403s
// instantly, a cheap fall-through), allorigins is valid but often slow,
// codetabs gets throttled by Yahoo's edge.
const PROXIES = [
  "https://market-pulse-proxy.suheb-khan.workers.dev/?url=",
  "https://corsproxy.io/?",
  "https://api.allorigins.win/raw?url=",
  "https://api.codetabs.com/v1/proxy?quest=",
] as const;

// Cap each proxy attempt so one hung/slow proxy (allorigins routinely
// stalls 10-20s) gets aborted and we rotate to the next instead of
// blocking the whole 5-min poll tick on it.
const ATTEMPT_TIMEOUT_MS = 8_000;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ATTEMPT_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// The seven tile symbols plus the two FX rates behind the currency picker
// ("cad"/"inr" — units of that currency per USD). The rates are not tiles;
// they ride the same rotation, retry and last-good machinery, and only the
// selected one is polled, so the default USD view fetches nothing extra.
export type YahooKey =
  | "copper"
  | "brent"
  | "tnx"
  | "tyx"
  | "gold"
  | "jpy"
  | "dxy"
  | "cad"
  | "inr";

const YAHOO_SYMBOL: Record<YahooKey, string> = {
  copper: "HG=F",
  brent: "BZ=F",
  tnx: "^TNX",
  tyx: "^TYX",
  gold: "GC=F",
  jpy: "JPY=X",
  dxy: "DX-Y.NYB",
  cad: "CAD=X",
  inr: "INR=X",
};

const YIELD_KEYS = new Set<YahooKey>(["tnx", "tyx"]);

export type YahooQuote = {
  price: number;
  previousClose: number;
  history: number[];
  lastUpdate: number;
};

function parseYahoo(key: YahooKey, result: any): YahooQuote {
  const meta = result.meta ?? {};
  const closes: (number | null)[] =
    result.indicators?.quote?.[0]?.close ?? [];

  const rawPrice: number = meta.regularMarketPrice;
  const rawPrev: number = meta.chartPreviousClose ?? meta.previousClose;
  const history = closes.filter((v): v is number => v != null);

  // Yahoo's yield tickers (^TNX, ^TYX) are sometimes reported as percent
  // (4.53) and sometimes as percent×10 (45.3). If we see a value above the
  // plausible yield range, assume the ×10 convention and rescale.
  const divisor = YIELD_KEYS.has(key) && rawPrice > 20 ? 10 : 1;

  return {
    price: rawPrice / divisor,
    previousClose: rawPrev / divisor,
    history: history.map((v) => v / divisor),
    lastUpdate:
      (meta.regularMarketTime ?? Math.floor(Date.now() / 1000)) * 1000,
  };
}

// One pass over the proxy rotation. Validates the payload *inside* the loop
// so a proxy that answers 200 with junk (an HTML interstitial, "Edge: Too
// Many Requests", a paywall) falls through to the next proxy instead of
// returning bad data or aborting the whole fetch.
async function fetchYahooOnce(key: YahooKey): Promise<YahooQuote> {
  const symbol = YAHOO_SYMBOL[key];
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`;
  const encoded = encodeURIComponent(target);
  let lastErr: unknown = new Error("no proxy attempted");

  for (const proxy of PROXIES) {
    try {
      const res = await fetchWithTimeout(proxy + encoded);
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      if (!result?.meta?.regularMarketPrice) {
        lastErr = new Error("empty/invalid result");
        continue;
      }
      return parseYahoo(key, result);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export async function fetchYahoo(key: YahooKey): Promise<YahooQuote> {
  // Two passes over the full rotation. The free proxies fail transiently
  // (slow allorigins, momentary Yahoo edge throttling), so a second pass
  // after a short pause clears most single-tick failures.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetchYahooOnce(key);
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await delay(700);
    }
  }
  throw lastErr;
}

export type BTCSpot = { price: number; lastUpdate: number };

export async function fetchBTCSpot(): Promise<BTCSpot> {
  const res = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot");
  if (!res.ok) throw new Error(`Coinbase HTTP ${res.status}`);
  const data = await res.json();
  const amount = parseFloat(data?.data?.amount);
  if (!isFinite(amount)) throw new Error("Coinbase bad amount");
  return { price: amount, lastUpdate: Date.now() };
}

export type BTCHistory = { previousClose: number; history: number[] };

export async function fetchBTCHistory(): Promise<BTCHistory> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=1",
  );
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const data = await res.json();
  const prices: [number, number][] = data?.prices ?? [];
  if (prices.length === 0) throw new Error("CoinGecko empty prices");
  return {
    previousClose: prices[0][1],
    history: prices.map((p) => p[1]),
  };
}
