import { useEffect, useState, type ReactNode } from "react";
import { COLORS, FONTS } from "./lib/theme";
import { fmtClock, fmtDate } from "./lib/format";
import { Tile, type TileState } from "./components/Tile";
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
// five symbols clear the proxy without 429-ing each other out.
const YAHOO_STAGGER_MS = 400;

const INITIAL: TileState = { loading: true };

function useYahooPoll(
  key: YahooKey,
  setState: (s: TileState) => void,
  staggerSlot: number,
) {
  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    async function tick() {
      try {
        const q = await fetchYahoo(key);
        if (cancelled) return;
        setState({
          loading: false,
          price: q.price,
          previousClose: q.previousClose,
          history: q.history,
          lastUpdate: q.lastUpdate,
        });
      } catch {
        if (cancelled) return;
        setState({ loading: false, error: true });
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
    <section style={{ marginBottom: 18 }}>
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.28em",
          color: COLORS.muted,
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 14,
        }}
      >
        {children}
      </div>
    </section>
  );
}

export default function App() {
  const [copper, setCopper] = useState<TileState>(INITIAL);
  const [brent, setBrent] = useState<TileState>(INITIAL);
  const [tnx, setTnx] = useState<TileState>(INITIAL);
  const [tyx, setTyx] = useState<TileState>(INITIAL);
  const [gold, setGold] = useState<TileState>(INITIAL);

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

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "48px 24px 60px",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div style={{ width: "100%", maxWidth: 980 }}>
        {/* eyebrow */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 16,
            fontSize: 10,
            letterSpacing: "0.28em",
            color: COLORS.muted,
            textTransform: "uppercase",
          }}
        >
          <span>Free-Tier Market Terminal</span>
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
        </div>

        {/* title + clock */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            margin: "2px 0 22px",
            gap: 24,
          }}
        >
          <h1
            style={{
              fontFamily: FONTS.display,
              fontStyle: "italic",
              fontWeight: 400,
              fontSize: 46,
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
              lineHeight: 1.5,
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
            margin: "0 0 18px",
          }}
        />

        <Section title="Scarce Assets">
          <Tile
            index={0}
            ticker="BTC-USD"
            name="BITCOIN"
            sublabel="Spot price, Coinbase"
            pricePrefix="$"
            priceDecimals={0}
            changeDecimals={0}
            live
            state={btc}
          />
          <Tile
            index={1}
            ticker="GC=F"
            name="GOLD"
            sublabel="Gold futures, $/oz"
            pricePrefix="$"
            state={gold}
          />
        </Section>

        <Section title="Energy & Metals">
          <Tile
            index={2}
            ticker="HG=F"
            name="COPPER"
            sublabel="Copper futures, $/lb"
            pricePrefix="$"
            priceDecimals={3}
            changeDecimals={3}
            state={copper}
          />
          <Tile
            index={3}
            ticker="BZ=F"
            name="BRENT CRUDE"
            sublabel="North Sea benchmark, $/bbl"
            pricePrefix="$"
            state={brent}
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

        {/* divider */}
        <div
          style={{
            height: 1,
            background: COLORS.border,
            margin: "22px 0 12px",
          }}
        />

        {/* sources */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 10,
            letterSpacing: "0.18em",
            color: COLORS.muted,
            textTransform: "uppercase",
          }}
        >
          <div>
            Sources — Yahoo via corsproxy.io · Coinbase · CoinGecko
          </div>
          <div>Polling: BTC 8s · Yahoo 5m · BTC 24h 5m</div>
        </div>

        {/* disclaimer */}
        <div
          style={{
            marginTop: 18,
            fontFamily: FONTS.display,
            fontStyle: "italic",
            fontSize: 12,
            lineHeight: 1.5,
            color: COLORS.textDim,
            maxWidth: 720,
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
