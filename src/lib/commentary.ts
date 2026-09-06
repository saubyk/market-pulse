// The day's LLM-written note (SPEC §5.7). Produced in CI by
// scripts/commentary.mjs into public/data/commentary.json, so it is a
// static file on the site's own origin — no proxy, no key, no polling.
// A clone with no committed note simply has no panel.

export type Commentary = {
  date: string; // "YYYY-MM-DD", UTC
  generatedAt: number;
  model: string;
  tradingDay: boolean;
  headline: string;
  body: string[];
  stats?: CommentaryStats;
};

// The promptFacts() rendering (scripts/commentary-lib.mjs). Only the
// parts the strip displays are typed; the rest is carried through.
export type CommentaryMove = { pct: number | null; abs?: number | null; bp?: number | null } | null;
export type CommentaryInstrument = {
  last: number | null;
  tradedToday: boolean;
  change: {
    day: CommentaryMove;
    week: CommentaryMove;
    month: CommentaryMove;
    threeMonths: CommentaryMove;
    yearToDate: CommentaryMove;
  };
  range52w: { high: number; low: number; positionInRange: number } | null;
  volatility: { annualizedPct: number; vsOwnYearMedian: number | null; regime: string | null } | null;
};
export type CommentaryStats = {
  date: string;
  tradingDay: boolean;
  instruments: Record<string, CommentaryInstrument>;
};

// After this many days without a fresh note the panel says so instead of
// presenting the old text as today's. The job runs every day, weekends
// included, so anything older than this means the pipeline is broken.
export const STALE_AFTER_DAYS = 3;

// Where a self-hosted copy looks for a fresher note when its own file is
// behind (issue #9): the copy the CI job commits to upstream `main`.
// raw.githubusercontent.com answers with `Access-Control-Allow-Origin: *`,
// so the browser reads it directly — no proxy. A fork that runs its own
// job should point this at its repo; set it to "" to keep the panel
// strictly on its own origin.
export const COMMENTARY_REMOTE_URL =
  "https://raw.githubusercontent.com/saubyk/market-pulse/main/public/data/commentary.json";

// How often an open tab re-checks for a newer note. The job runs once a
// day, so anything finer than this only costs requests.
export const REFRESH_MS = 60 * 60_000;

export async function fetchCommentaryFrom(url: string): Promise<Commentary | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return isCommentary(data) ? data : null;
}

export async function fetchCommentary(): Promise<Commentary | null> {
  return fetchCommentaryFrom(`${import.meta.env.BASE_URL}data/commentary.json`);
}

// The note to show: the site's own file, or the upstream copy when that
// is newer. An absent local file still means "no panel" — a fork that
// has never run the job must not display someone else's note — and the
// remote is only asked for when the local note is not today's, so a
// deploy that refreshes daily never makes the extra request once its
// job has run. Remote failures are silent: the local note is the floor.
export async function loadCommentary(now: Date): Promise<Commentary | null> {
  const local = await fetchCommentary();
  if (!local) return null;
  if (!needsRemote(local, now) || !COMMENTARY_REMOTE_URL) return local;
  const remote = await fetchCommentaryFrom(COMMENTARY_REMOTE_URL).catch(() => null);
  return newerNote(local, remote);
}

// Whether the local note is old enough to be worth checking upstream:
// anything not dated on today's UTC day.
export function needsRemote(local: Commentary | null, now: Date): boolean {
  return local != null && commentaryAgeDays(local.date, now) > 0;
}

// Prefer the newer note; ties go to the local one, since it is the copy
// this very site was built with.
export function newerNote(local: Commentary, remote: Commentary | null): Commentary {
  return remote != null && remote.date > local.date ? remote : local;
}

function isCommentary(d: unknown): d is Commentary {
  if (!d || typeof d !== "object") return false;
  const c = d as Record<string, unknown>;
  return (
    typeof c.date === "string" &&
    typeof c.headline === "string" &&
    Array.isArray(c.body) &&
    c.body.every((p) => typeof p === "string")
  );
}

// Whole UTC days between the note's date and `now`.
export function commentaryAgeDays(date: string, now: Date): number {
  const [y, m, d] = date.split("-").map(Number);
  const noteDay = Date.UTC(y, m - 1, d);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((today - noteDay) / 86_400_000);
}

export function isStale(c: Commentary, now: Date): boolean {
  return commentaryAgeDays(c.date, now) > STALE_AFTER_DAYS;
}

// "AUG 23" style, matching the header's uppercase date.
export function fmtNoteDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    .toUpperCase();
}

// Expanded/collapsed persists per browser, like the theme and currency.
const OPEN_KEY = "mp-commentary-open";

export function loadOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveOpen(open: boolean) {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    // best-effort, same as the theme toggle
  }
}

// The eight tiles, in dashboard order, keyed by the display names the
// stats use. The picker rates are left out of the strip.
export const STRIP_INSTRUMENTS: { name: string; label: string; yieldLike?: boolean }[] = [
  { name: "Bitcoin", label: "BTC" },
  { name: "Gold", label: "GOLD" },
  { name: "Copper", label: "COPPER" },
  { name: "Brent crude", label: "BRENT" },
  { name: "US 10-year Treasury yield", label: "10Y", yieldLike: true },
  { name: "US 30-year Treasury yield", label: "30Y", yieldLike: true },
  { name: "USD/JPY", label: "USD/JPY" },
  { name: "US Dollar Index (DXY)", label: "DXY" },
];

// "+6.9%" / "-12bp" / "—"
export function fmtMove(m: CommentaryMove, yieldLike = false): string {
  if (!m) return "—";
  if (yieldLike && typeof m.bp === "number") {
    const v = Math.round(m.bp);
    return `${v > 0 ? "+" : ""}${v}bp`;
  }
  if (typeof m.pct !== "number") return "—";
  return `${m.pct > 0 ? "+" : ""}${m.pct.toFixed(1)}%`;
}
