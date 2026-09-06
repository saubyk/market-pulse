import { useEffect, useState } from "react";
import { COLORS } from "../lib/theme";
import {
  REFRESH_MS,
  STRIP_INSTRUMENTS,
  commentaryAgeDays,
  fmtMove,
  fmtNoteDate,
  isStale,
  loadCommentary,
  loadOpen,
  saveOpen,
  type Commentary as Note,
} from "../lib/commentary";

// "Today's read": the day's LLM-written note, loaded from the site's own
// origin — or from upstream when that copy is newer, so a self-hosted
// checkout that is behind still shows the current note (issue #9) — and
// re-checked hourly so an open tab rolls over. Collapsed to one row by
// default so the one-viewport layout is untouched; the row hides entirely
// when there is no note (a fresh clone, a 404) and says so honestly when
// the note is old. Hover and the breakpoint-dependent strip live in
// styles.css (.read-*).
export function Commentary({ now }: { now: Date }) {
  const [note, setNote] = useState<Note | null | undefined>(undefined);
  const [open, setOpen] = useState<boolean>(loadOpen);

  useEffect(() => {
    let cancelled = false;
    function load() {
      loadCommentary(new Date())
        .then((n) => {
          if (!cancelled) setNote(n);
        })
        .catch(() => {
          // A failed first load hides the row; a failed re-check keeps
          // whatever note is already showing.
          if (!cancelled) setNote((prev) => prev ?? null);
        });
    }
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Not loaded yet, or nothing to show: render nothing rather than a
  // placeholder, so the dashboard never reserves space for an absent note.
  if (!note) return null;

  const stale = isStale(note, now);
  const noteDate = fmtNoteDate(note.date);
  // Notes describe an exchange session, so on a weekend, a holiday or a
  // weekday morning the current note is an earlier day's: say so in the
  // label rather than calling Friday's read "today's".
  const today = commentaryAgeDays(note.date, now) <= 0;

  function toggle() {
    const next = !open;
    setOpen(next);
    saveOpen(next);
  }

  return (
    <section
      style={{
        margin: "-2px 0 10px",
        borderBottom: `1px solid ${COLORS.border}`,
        paddingBottom: open ? 10 : 6,
      }}
    >
      <button
        type="button"
        className="read-toggle"
        aria-expanded={open}
        aria-controls="todays-read"
        onClick={toggle}
      >
        <span className="read-label">
          {today ? <>Today&rsquo;s read</> : <>Last read &middot; {noteDate}</>}
        </span>
        <span className="read-sep" aria-hidden="true">
          —
        </span>
        <span
          className="read-headline"
          style={{ color: stale ? COLORS.muted : COLORS.text }}
        >
          {stale ? `no commentary since ${noteDate}` : note.headline}
        </span>
        <span className="read-chevron" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open ? (
        <div id="todays-read" className="read-body">
          {stale ? (
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.12em",
                color: COLORS.down,
                textTransform: "uppercase",
                marginBottom: 6,
              }}
            >
              Last note is from {noteDate} — no session since has been written up
            </div>
          ) : null}
          {stale ? (
            <div className="read-old-headline" style={{ color: COLORS.text }}>
              {note.headline}
            </div>
          ) : null}
          {/* Sizes live in styles.css (.read-para): the display serif has a
              small x-height, so it runs larger than body text, and the
              mobile size differs — inline styles can't do breakpoints. */}
          {note.body.map((p, i) => (
            <p key={i} className="read-para" style={{ color: COLORS.text }}>
              {p}
            </p>
          ))}

          {note.stats ? (
            <div className="read-strip">
              {STRIP_INSTRUMENTS.map(({ name, label, yieldLike }) => {
                const s = note.stats?.instruments[name];
                if (!s) return null;
                return (
                  <div key={name} className="read-stat">
                    <span style={{ color: COLORS.text }}>{label}</span>
                    <span style={{ color: COLORS.textDim }}>
                      {fmtMove(s.change.week, yieldLike)}
                      <span style={{ color: COLORS.faint }}> wk </span>
                      {fmtMove(s.change.month, yieldLike)}
                      <span style={{ color: COLORS.faint }}> mo </span>
                      {fmtMove(s.change.yearToDate, yieldLike)}
                      <span style={{ color: COLORS.faint }}> ytd</span>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div
            style={{
              marginTop: 8,
              fontSize: 10,
              letterSpacing: "0.18em",
              color: COLORS.muted,
              textTransform: "uppercase",
            }}
          >
            AI-generated from the day&rsquo;s numbers · {noteDate}
            {note.tradingDay ? "" : " · markets closed"} · not investment
            advice
          </div>
        </div>
      ) : null}
    </section>
  );
}
