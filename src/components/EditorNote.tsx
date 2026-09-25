import { useEffect, useState } from "react";
import { COLORS } from "../lib/theme";
import { REFRESH_MS, fmtNoteDate } from "../lib/commentary";
import {
  currentNote,
  fetchNotes,
  loadOpen,
  saveOpen,
  type EditorNote as Note,
} from "../lib/notes";

// "Editor's note": the site editor's own commentary on a current event,
// shown as its own collapsed row above "Today's read" while a note is
// active (its date through its until) — only the newest one, when
// several are. Renders nothing when no note is active, so it only costs
// vertical space when there is something to say. Shares the .read-*
// styles with the daily note.
export function EditorNote({ now }: { now: Date }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [open, setOpen] = useState<boolean>(loadOpen);

  useEffect(() => {
    let cancelled = false;
    function load() {
      fetchNotes()
        .then((n) => {
          if (!cancelled) setNotes(n);
        })
        .catch(() => {
          // A failed re-check keeps whatever is already showing.
        });
    }
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const note = currentNote(notes, now);
  if (!note) return null;

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
        aria-controls="editor-note"
        onClick={toggle}
      >
        <span className="read-label">
          Editor&rsquo;s note &middot; {fmtNoteDate(note.date)}
        </span>
        <span className="read-sep" aria-hidden="true">
          —
        </span>
        <span className="read-headline" style={{ color: COLORS.text }}>
          {note.title}
        </span>
        <span className="read-chevron" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open ? (
        <div id="editor-note" className="read-body">
          {note.body.map((p, i) => (
            <p key={i} className="read-para" style={{ color: COLORS.text }}>
              {p}
            </p>
          ))}
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.18em",
              color: COLORS.muted,
              textTransform: "uppercase",
            }}
          >
            Editor&rsquo;s note · written {fmtNoteDate(note.date)} · not
            investment advice
          </div>
        </div>
      ) : null}
    </section>
  );
}
