const PROXY = "https://corsproxy.io/?";

export type YahooKey = "wti" | "brent" | "tnx";

const YAHOO_SYMBOL: Record<YahooKey, string> = {
  wti: "CL=F",
  brent: "BZ=F",
  tnx: "^TNX",
};

export type YahooQuote = {
  price: number;
  previousClose: number;
  history: number[];
  lastUpdate: number;
};

export async function fetchYahoo(key: YahooKey): Promise<YahooQuote> {
  const symbol = YAHOO_SYMBOL[key];
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`;
  const res = await fetch(PROXY + encodeURIComponent(target));
  if (!res.ok) throw new Error(`Yahoo ${symbol} HTTP ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo ${symbol} empty result`);

  const meta = result.meta ?? {};
  const closes: (number | null)[] =
    result.indicators?.quote?.[0]?.close ?? [];

  const rawPrice: number = meta.regularMarketPrice;
  const rawPrev: number = meta.chartPreviousClose ?? meta.previousClose;
  const history = closes.filter((v): v is number => v != null);

  // ^TNX is sometimes reported as percent (4.53) and sometimes as percent×10
  // (45.3). If we see a value above the plausible yield range, assume the
  // ×10 convention and rescale.
  const divisor = key === "tnx" && rawPrice > 20 ? 10 : 1;

  return {
    price: rawPrice / divisor,
    previousClose: rawPrev / divisor,
    history: history.map((v) => v / divisor),
    lastUpdate:
      (meta.regularMarketTime ?? Math.floor(Date.now() / 1000)) * 1000,
  };
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
