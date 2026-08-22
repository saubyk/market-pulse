import { useEffect, useRef, useState, type ReactNode } from "react";
import { COLORS, FONTS } from "./lib/theme";
import { fmtClock, fmtDate, fmtNum, fmtTime } from "./lib/format";
import { Tile, type TileState } from "./components/Tile";
import { ThemeToggle } from "./components/ThemeToggle";
import { CurrencyPicker } from "./components/CurrencyPicker";
import {
  CURRENCIES,
  loadCurrency,
  saveCurrency,
  type Currency,
} from "./lib/currency";
import {
  fetchYahoo,
  fetchBTCSpot,
  fetchBTCHistory,
  type YahooKey,
} from "./lib/fetchers";

const POLL_YAHOO_MS = 5 * 60_000;
const POLL_BTC_SPOT_MS = 8_000;
const POLL_BTC_HISTORY_MS = 5 * 60_000;

// Free CORS proxies (corsproxy.io, allorigins) rate-limit bursts from a
// single IP. Yahoo fetches are dispatched serially with this gap so all
// eight symbols — the seven tiles plus the selected currency's FX rate —
// clear the proxy without 429-ing each other out.
const YAHOO_STAGGER_MS = 400;

const INITIAL: TileState = { loading: true };

// Per-tile persistence of the last good Yahoo quote. On a cold load the
// tile renders the previous session's price immediately — its UPD
// timestamp honestly signals the staleness — instead of "fetch failed"
// when every proxy is having a bad tick. Best-effort: private mode or
// disabled storage just degrades to the in-memory behavior.
const STORAGE_PREFIX = "mp-lastgood-";

function loadStoredQuote(key: YahooKey): TileState | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const q = JSON.parse(raw);
    if (typeof q?.price !== "number" || typeof q?.previousClose !== "number") {
      return null;
    }
    return {
      loading: false,
      price: q.price,
      previousClose: q.previousClose,
      history: Array.isArray(q.history) ? q.history : undefined,
      lastUpdate: typeof q.lastUpdate === "number" ? q.lastUpdate : undefined,
    };
  } catch {
    return null;
  }
}

function saveStoredQuote(key: YahooKey, state: TileState) {
  try {
    localStorage.setItem(
      STORAGE_PREFIX + key,
      JSON.stringify({
        price: state.price,
        previousClose: state.previousClose,
        history: state.history,
        lastUpdate: state.lastUpdate,
      }),
    );
  } catch {
    // storage full or disabled — persistence is best-effort
  }
}

function useYahooPoll(
  key: YahooKey | null,
  setState: (s: TileState) => void,
  staggerSlot: number,
) {
  // Last successful quote for this key. On a transient proxy failure we
  // re-show this (with its original UPD timestamp, which honestly signals
  // staleness) rather than blanking the tile to "fetch failed". Only a tile
  // that has never loaded shows the error state.
  const lastGood = useRef<TileState | null>(null);
  const lastGoodKey = useRef<YahooKey | null>(null);

  useEffect(() => {
    // The FX-rate caller passes null while USD is selected: nothing to poll.
    if (key == null) return;
    // Bound to a const so the null-narrowing survives into tick()'s closure.
    const symbol = key;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    // Hydrate from the previous session right away (not staggered) so the
    // tile shows honestly-stale data, not a spinner, while the first fetch
    // is pending — and not "fetch failed" if that fetch loses the proxy
    // lottery. Keyed on the symbol, so switching CAD -> INR drops the old
    // rate instead of showing Canadian numbers under a rupee sign.
    if (lastGoodKey.current !== symbol) {
      lastGoodKey.current = symbol;
      lastGood.current = loadStoredQuote(symbol);
      setState(lastGood.current ?? INITIAL);
    }

    async function tick() {
      try {
        const q = await fetchYahoo(symbol);
        if (cancelled) return;
        const next: TileState = {
          loading: false,
          price: q.price,
          previousClose: q.previousClose,
          history: q.history,
          lastUpdate: q.lastUpdate,
        };
        lastGood.current = next;
        saveStoredQuote(symbol, next);
        setState(next);
      } catch {
        if (cancelled) return;
        setState(lastGood.current ?? { loading: false, error: true });
      }
    }

    const startTimeout = setTimeout(() => {
      if (cancelled) return;
      tick();
      intervalId = setInterval(tick, POLL_YAHOO_MS);
    }, staggerSlot * YAHOO_STAGGER_MS);

    return () => {
      cancelled = true;
      clearTimeout(startTimeout);
      if (intervalId !== undefined) clearInterval(intervalId);
    };
  }, [key, setState, staggerSlot]);
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section style={{ marginBottom: 6 }}>
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.28em",
          color: COLORS.muted,
          textTransform: "uppercase",
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      <div className="tile-grid">{children}</div>
    </section>
  );
}

export default function App() {
  const [copper, setCopper] = useState<TileState>(INITIAL);
  const [brent, setBrent] = useState<TileState>(INITIAL);
  const [tnx, setTnx] = useState<TileState>(INITIAL);
  const [tyx, setTyx] = useState<TileState>(INITIAL);
  const [gold, setGold] = useState<TileState>(INITIAL);
  const [jpy, setJpy] = useState<TileState>(INITIAL);
  const [dxy, setDxy] = useState<TileState>(INITIAL);

  // Display currency for the dollar-priced tiles, plus the FX rate behind
  // it. USD needs no rate, so the default view issues exactly the requests
  // it always did.
  const [currency, setCurrency] = useState<Currency>(loadCurrency);
  const [fx, setFx] = useState<TileState>(INITIAL);

  // BTC has two sources (Coinbase spot + CoinGecko history). Each updates
  // independently and merges into one tile state.
  const [btcSpot, setBtcSpot] = useState<{
    price?: number;
    lastUpdate?: number;
    error?: boolean;
  }>({});
  const [btcHist, setBtcHist] = useState<{
    previousClose?: number;
    history?: number[];
  }>({});

  const [now, setNow] = useState(() => new Date());

  useYahooPoll("copper", setCopper, 0);
  useYahooPoll("brent", setBrent, 1);
  useYahooPoll("tnx", setTnx, 2);
  useYahooPoll("tyx", setTyx, 3);
  useYahooPoll("gold", setGold, 4);
  useYahooPoll("jpy", setJpy, 5);
  useYahooPoll("dxy", setDxy, 6);
  useYahooPoll(CURRENCIES[currency].rateKey, setFx, 7);

  // BTC spot
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const s = await fetchBTCSpot();
        if (cancelled) return;
        setBtcSpot({ price: s.price, lastUpdate: s.lastUpdate });
      } catch {
        if (cancelled) return;
        setBtcSpot((prev) => ({ ...prev, error: true }));
      }
    }
    tick();
    const id = setInterval(tick, POLL_BTC_SPOT_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // BTC history (CoinGecko)
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const h = await fetchBTCHistory();
        if (cancelled) return;
        setBtcHist({ previousClose: h.previousClose, history: h.history });
      } catch {
        // Keep prior values on failure; spec §7: BTC tile keeps showing
        // live spot price but sparkline / 24h change stay stale.
      }
    }
    tick();
    const id = setInterval(tick, POLL_BTC_HISTORY_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // 1s clock
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const btc: TileState = {
    loading: btcSpot.price == null && !btcSpot.error,
    error: btcSpot.error && btcSpot.price == null,
    price: btcSpot.price,
    previousClose: btcHist.previousClose,
    history: btcHist.history,
    lastUpdate: btcSpot.lastUpdate,
  };

  // Conversion happens at render time only: fetched and persisted quotes
  // stay in USD, so switching currency never disturbs the poll loops or the
  // stored last-good values.
  const fxRate = currency === "USD" ? 1 : fx.price;
  // Until the rate arrives — or if it never does — show honest USD rather
  // than a converted number we can't back up. The footer says which.
  const shown = fxRate != null ? currency : "USD";
  const sym = CURRENCIES[shown].symbol;
  const rate = fxRate ?? 1;

  function inCurrency(t: TileState): TileState {
    if (rate === 1) return t;
    return {
      ...t,
      price: t.price == null ? undefined : t.price * rate,
      previousClose:
        t.previousClose == null ? undefined : t.previousClose * rate,
      history: t.history?.map((v) => v * rate),
    };
  }

  function changeCurrency(next: Currency) {
    setCurrency(next);
    saveCurrency(next);
  }

  // Disclose the rate the converted tiles were actually multiplied by: it
  // is a 15-minute-delayed Yahoo quote, so once converted even the live BTC
  // price is only as fresh as this.
  const { pair, rateDecimals } = CURRENCIES[currency];
  const fxNote =
    currency === "USD"
      ? null
      : fxRate != null
        ? `FX ${pair} ${fmtNum(fxRate, rateDecimals)}` +
          (fx.lastUpdate ? ` · UPD ${fmtTime(fx.lastUpdate)}` : "")
        : fx.loading
          ? `${pair} rate loading…`
          : `${pair} rate unavailable — showing USD`;

  return (
    <div
      className="app-shell"
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div className="app-frame">
        {/* eyebrow */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            flexWrap: "wrap",
            gap: "4px 16px",
            fontSize: 10,
            letterSpacing: "0.28em",
            color: COLORS.muted,
            textTransform: "uppercase",
          }}
        >
          <span>Free-Tier Market Terminal</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 14 }}>
            <a
              href="https://satusd.com/"
              style={{
                color: COLORS.muted,
                textDecoration: "none",
                letterSpacing: "0.28em",
              }}
            >
              ← satusd.com
            </a>
            <CurrencyPicker value={currency} onChange={changeCurrency} />
            <ThemeToggle />
          </span>
        </div>

        {/* title + clock */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            flexWrap: "wrap",
            margin: "2px 0 12px",
            gap: "8px 24px",
          }}
        >
          <h1
            style={{
              fontFamily: FONTS.display,
              fontStyle: "italic",
              fontWeight: 400,
              fontSize: "clamp(30px, 8vw, 40px)",
              margin: 0,
              color: COLORS.text,
              lineHeight: 1,
            }}
          >
            Market Pulse
          </h1>
          <div
            style={{
              textAlign: "right",
              fontSize: 12,
              letterSpacing: "0.16em",
              color: COLORS.textDim,
              lineHeight: 1.3,
            }}
          >
            <div>{fmtDate(now)}</div>
            <div style={{ color: COLORS.text, fontSize: 18 }}>
              {fmtClock(now)}
            </div>
          </div>
        </div>

        {/* divider */}
        <div
          style={{
            height: 1,
            background: COLORS.border,
            margin: "0 0 12px",
          }}
        />

        <Section title="Scarce Assets">
          <Tile
            index={0}
            ticker="BTC-USD"
            name="BITCOIN"
            sublabel="Spot price, Coinbase"
            pricePrefix={sym}
            priceDecimals={0}
            changeDecimals={0}
            live
            state={inCurrency(btc)}
          />
          <Tile
            index={1}
            ticker="GC=F"
            name="GOLD"
            sublabel={`Gold futures, ${sym}/oz`}
            pricePrefix={sym}
            state={inCurrency(gold)}
          />
        </Section>

        <Section title="Energy & Metals">
          <Tile
            index={2}
            ticker="HG=F"
            name="COPPER"
            sublabel={`Copper futures, ${sym}/lb`}
            pricePrefix={sym}
            priceDecimals={3}
            changeDecimals={3}
            state={inCurrency(copper)}
          />
          <Tile
            index={3}
            ticker="BZ=F"
            name="BRENT CRUDE"
            sublabel={`North Sea benchmark, ${sym}/bbl`}
            pricePrefix={sym}
            state={inCurrency(brent)}
          />
        </Section>

        <Section title="US Treasuries">
          <Tile
            index={4}
            ticker="^TNX"
            name="US 10Y YIELD"
            sublabel="10-year Treasury yield, %"
            priceDecimals={3}
            changeDecimals={3}
            state={tnx}
          />
          <Tile
            index={5}
            ticker="^TYX"
            name="US 30Y YIELD"
            sublabel="30-year Treasury yield, %"
            priceDecimals={3}
            changeDecimals={3}
            state={tyx}
          />
        </Section>

        <Section title="Currencies">
          <Tile
            index={6}
            ticker="JPY=X"
            name="USD/JPY"
            sublabel="Yen per US dollar"
            state={jpy}
          />
          <Tile
            index={7}
            ticker="DX-Y.NYB"
            name="DOLLAR INDEX"
            sublabel="ICE US Dollar Index (DXY)"
            state={dxy}
          />
        </Section>

        {/* divider */}
        <div
          style={{
            height: 1,
            background: COLORS.border,
            margin: "4px 0 10px",
          }}
        />

        {/* sources */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "6px 16px",
            fontSize: 10,
            letterSpacing: "0.18em",
            color: COLORS.muted,
            textTransform: "uppercase",
          }}
        >
          <div>
            Sources — Yahoo (proxied) · Coinbase · CoinGecko
            {fxNote ? <span>{" · "}{fxNote}</span> : null}
          </div>
          <div>Polling: BTC 8s · Yahoo 5m · BTC 24h 5m</div>
        </div>

        {/* disclaimer */}
        <div
          style={{
            marginTop: 6,
            fontFamily: FONTS.display,
            fontStyle: "italic",
            fontSize: 11,
            lineHeight: 1.45,
            color: COLORS.textDim,
          }}
        >
          Not investment advice. Prices are delayed by at least 15 minutes for
          commodities and Treasury yields. Bitcoin spot is sourced from Coinbase.
          Data sources may rate-limit or fail without notice.
        </div>
      </div>
    </div>
  );
}
