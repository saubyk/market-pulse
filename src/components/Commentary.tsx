import { useEffect, useState } from "react";
import { COLORS, FONTS } from "../lib/theme";
import {
  STRIP_INSTRUMENTS,
  fetchCommentary,
  fmtMove,
  fmtNoteDate,
  isStale,
  loadOpen,
  saveOpen,
  type Commentary as Note,
} from "../lib/commentary";

// "Today's read": the day's LLM-written note, fetched once from the
// site's own origin. Collapsed to one row by default so the one-viewport
// layout is untouched; the row hides entirely when there is no note
// (a fresh clone, a 404) and says so honestly when the note is old.
// Hover and the breakpoint-dependent strip live in styles.css (.read-*).
export function Commentary({ now }: { now: Date }) {
  const [note, setNote] = useState<Note | null | undefined>(undefined);
  const [open, setOpen] = useState<boolean>(loadOpen);

  useEffect(() => {
    let cancelled = false;
    fetchCommentary()
      .then((n) => {
        if (!cancelled) setNote(n);
      })
      .catch(() => {
        if (!cancelled) setNote(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Not loaded yet, or nothing to show: render nothing rather than a
  // placeholder, so the dashboard never reserves space for an absent note.
  if (!note) return null;

  const stale = isStale(note, now);
  const noteDate = fmtNoteDate(note.date);

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
        <span className="read-label">Today&rsquo;s read</span>
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
              Last note is from {noteDate} — the daily job has not run since
            </div>
          ) : null}
          {stale ? (
            <div
              style={{
                fontFamily: FONTS.display,
                fontSize: 16,
                lineHeight: 1.3,
                color: COLORS.text,
                marginBottom: 6,
              }}
            >
              {note.headline}
            </div>
          ) : null}
          {note.body.map((p, i) => (
            <p
              key={i}
              style={{
                fontFamily: FONTS.display,
                fontSize: 15,
                lineHeight: 1.45,
                color: COLORS.text,
                margin: "0 0 8px",
                maxWidth: "72ch",
              }}
            >
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
