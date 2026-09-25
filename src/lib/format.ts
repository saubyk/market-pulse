function withSign(n: number, body: string): string {
  return n > 0 ? `+${body}` : body;
}

export function fmtNum(n: number, decimals = 2): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtUSD(n: number, decimals = 2): string {
  return "$" + fmtNum(n, decimals);
}

export function fmtChg(n: number, decimals = 2): string {
  return withSign(n, fmtNum(n, decimals));
}

export function fmtPct(n: number): string {
  return withSign(n, `${n.toFixed(2)}%`);
}

export function fmtClock(d: Date): string {
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function fmtDate(d: Date): string {
  return d
    .toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    })
    .toUpperCase();
}

export function fmtTime(ts: number): string {
  return fmtClock(new Date(ts));
}

// Freshness tag for a quote whose market has stopped trading: "CLOSE 3PM
// ET" — the session end in New York time — whenever `now` falls outside
// the regular session, else null. Yahoo's ^TNX/^TYX are Cboe indices that
// stop at 3pm ET while cash Treasuries keep trading, so after the close the
// tile's yield can sit several bp from a live quote; the tag says why.
export function fmtCloseTag(
  session: { start: number; end: number } | undefined,
  now: number,
): string | null {
  if (!session || (now >= session.start && now < session.end)) return null;
  const t = new Date(session.end)
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/New_York",
    })
    .replace(":00", "")
    .replace(/\s/g, "");
  return `CLOSE ${t} ET`;
}
