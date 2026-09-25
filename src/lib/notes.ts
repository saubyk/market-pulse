// The editor's notes (SPEC §3.9, §5.8): hand-written commentary on current
// events, kept in notes/*.md and compiled by scripts/notes.mjs into
// public/data/notes.json at dev/build time. A static file on the site's
// own origin, like the daily note; an absent or empty file means no row.

export type EditorNote = {
  file: string;
  title: string;
  date: string; // "YYYY-MM-DD", UTC — written, and first shown
  until: string; // "YYYY-MM-DD", UTC — last day shown, inclusive
  body: string[];
};

export async function fetchNotes(): Promise<EditorNote[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/notes.json`);
  if (!res.ok) return [];
  const data: unknown = await res.json();
  return Array.isArray(data) ? data.filter(isNote) : [];
}

function isNote(d: unknown): d is EditorNote {
  if (!d || typeof d !== "object") return false;
  const n = d as Record<string, unknown>;
  return (
    typeof n.file === "string" &&
    typeof n.title === "string" &&
    typeof n.date === "string" &&
    typeof n.until === "string" &&
    Array.isArray(n.body) &&
    n.body.every((p) => typeof p === "string")
  );
}

// The note to show at `now`: the newest (by date, then file name) that
// was written on or before today's UTC date and is not past its `until`,
// or null. Only one note is ever shown — the same rule the commentary job
// uses to pick what the model sees (currentNote() in notes-lib.mjs).
export function currentNote(notes: EditorNote[], now: Date): EditorNote | null {
  const today = now.toISOString().slice(0, 10);
  const active = notes
    .filter((n) => n.date <= today && today <= n.until)
    .sort((a, b) =>
      a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.file < b.file ? 1 : a.file > b.file ? -1 : 0,
    );
  return active[0] ?? null;
}

// Expanded/collapsed persists per browser, separately from the daily note.
const OPEN_KEY = "mp-editor-note-open";

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
