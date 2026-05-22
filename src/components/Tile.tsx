import { COLORS, FONTS } from "../lib/theme";
import { fmtNum, fmtChg, fmtPct, fmtTime } from "../lib/format";
import { Sparkline } from "./Sparkline";
import { LiveDot } from "./LiveDot";

export type TileState = {
  loading: boolean;
  error?: boolean;
  price?: number;
  previousClose?: number;
  history?: number[];
  lastUpdate?: number;
};

type Props = {
  ticker: string;
  name: string;
  sublabel: string;
  pricePrefix?: string;
  priceDecimals?: number;
  changeDecimals?: number;
  live?: boolean;
  state: TileState;
  index: number;
};

export function Tile({
  ticker,
  name,
  sublabel,
  pricePrefix = "",
  priceDecimals = 2,
  changeDecimals = 2,
  live = false,
  state,
  index,
}: Props) {
  const { loading, error, price, previousClose, history, lastUpdate } = state;

  const hasChange = price != null && previousClose != null;
  const change = hasChange ? price! - previousClose! : 0;
  const changePct = hasChange ? (change / previousClose!) * 100 : 0;
  const direction: "up" | "down" | "flat" =
    !hasChange ? "flat" : change > 0 ? "up" : change < 0 ? "down" : "flat";
  const changeColor =
    direction === "up"
      ? COLORS.up
      : direction === "down"
        ? COLORS.down
        : COLORS.textDim;
  const arrow = direction === "up" ? "▲" : direction === "down" ? "▼" : "—";

  const priceStr =
    price != null ? pricePrefix + fmtNum(price, priceDecimals) : null;

  return (
    <div
      style={{
        border: `1px solid ${COLORS.border}`,
        background: COLORS.panel,
        borderRadius: 6,
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minHeight: 168,
        opacity: 0,
        animation: "fadeUp 0.6s ease-out forwards",
        animationDelay: `${index * 0.08}s`,
      }}
    >
      {/* top row: ticker + freshness */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 11,
          letterSpacing: "0.12em",
        }}
      >
        <div style={{ color: COLORS.textDim }}>
          <span style={{ color: COLORS.text }}>{ticker}</span>
          <span style={{ color: COLORS.faint, margin: "0 8px" }}>·</span>
          <span>{name}</span>
        </div>
        <div
          style={{
            color: live ? COLORS.amber : COLORS.muted,
            fontSize: 10,
            letterSpacing: "0.18em",
          }}
        >
          {live ? (
            <>
              <LiveDot />
              LIVE
            </>
          ) : (
            "DLY 15m"
          )}
        </div>
      </div>

      {/* sublabel */}
      <div
        style={{
          fontFamily: FONTS.display,
          fontStyle: "italic",
          fontSize: 14,
          color: COLORS.textDim,
        }}
      >
        {sublabel}
      </div>

      {/* price */}
      <div
        style={{
          fontSize: 38,
          fontWeight: 300,
          letterSpacing: "-0.01em",
          color: error ? COLORS.down : COLORS.text,
          lineHeight: 1.05,
          marginTop: 2,
          minHeight: 42,
        }}
      >
        {error ? "fetch failed" : loading || priceStr == null ? "…" : priceStr}
      </div>

      {/* change + sparkline */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginTop: "auto",
        }}
      >
        <div
          style={{
            color: changeColor,
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 8,
            visibility: hasChange ? "visible" : "hidden",
          }}
        >
          <span>{arrow}</span>
          <span>{fmtChg(change, changeDecimals)}</span>
          <span style={{ color: COLORS.textDim }}>{fmtPct(changePct)}</span>
        </div>
        <div>
          {history && history.length >= 2 ? (
            <Sparkline data={history} color={changeColor} />
          ) : (
            <div style={{ width: 140, height: 36 }} />
          )}
        </div>
      </div>

      {/* footer timestamp */}
      <div
        style={{
          fontSize: 10,
          color: COLORS.muted,
          letterSpacing: "0.16em",
          marginTop: 2,
        }}
      >
        {lastUpdate ? `UPD ${fmtTime(lastUpdate)}` : " "}
      </div>
    </div>
  );
}
