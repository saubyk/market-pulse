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
