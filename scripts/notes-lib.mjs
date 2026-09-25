// Pure helpers behind the editor's notes (SPEC §3.9): parsing and
// validating a hand-written notes/*.md file, and picking the note that
// is current on a given date. No I/O. Used by scripts/notes.mjs (which
// compiles notes/ into public/data/notes.json for the dashboard) and by
// scripts/commentary.mjs (which hands the current one to the model).

export const NOTES_DIR = "notes";
export const NOTES_JSON_PATH = "public/data/notes.json";

const REQUIRED = ["title", "date", "until"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_TITLE = 120;

// A note is a Markdown file with a small front-matter header:
//
//   ---
//   title: Fed cuts 50bp in a surprise move
//   date: 2026-09-24
//   until: 2026-10-08
//   ---
//   First paragraph...
//
//   Second paragraph...
//
// `date` is when it was written (and the first day it is shown), `until`
// the last day it is active, inclusive — both UTC calendar dates, both
// required. The body is plain paragraphs separated by blank lines; lines
// within a paragraph are joined. Markdown syntax is not rendered.
// Throws with the file name on anything malformed, so a bad note fails
// the build rather than shipping.
export function parseNote(text, file) {
  const fail = (msg) => {
    throw new Error(`${file}: ${msg}`);
  };
  const m = text.replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) fail("missing front matter (a --- header block at the top)");

  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const kv = line.match(/^([A-Za-z]+):\s*(.*)$/);
    if (!kv) fail(`bad header line "${line}"`);
    const key = kv[1].toLowerCase();
    if (!REQUIRED.includes(key)) fail(`unknown header "${kv[1]}" (expected ${REQUIRED.join(", ")})`);
    meta[key] = kv[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  for (const key of REQUIRED) {
    if (!meta[key]) fail(`missing "${key}"`);
  }
  if (meta.title.length > MAX_TITLE) fail(`title longer than ${MAX_TITLE} characters`);
  for (const key of ["date", "until"]) {
    if (!DATE_RE.test(meta[key]) || !isRealDate(meta[key])) {
      fail(`"${key}" must be a YYYY-MM-DD date, got "${meta[key]}"`);
    }
  }
  if (meta.until < meta.date) fail(`"until" (${meta.until}) is before "date" (${meta.date})`);

  const body = m[2]
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.split(/\r?\n/).map((l) => l.trim()).join(" ").trim())
    .filter(Boolean);
  if (body.length === 0) fail("empty body");

  return { file, title: meta.title, date: meta.date, until: meta.until, body };
}

function isRealDate(s) {
  const [y, mo, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

// Which files in notes/ are notes: every .md except a README.
export function isNoteFile(name) {
  return name.endsWith(".md") && !/^readme\.md$/i.test(name);
}

// Newest first: by date, then by file name so the order is stable.
export function sortNotes(notes) {
  return [...notes].sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.file < b.file ? 1 : a.file > b.file ? -1 : 0,
  );
}

// The note current on `date` (YYYY-MM-DD): the newest one written on or
// before it and not yet past its `until`, or null. Only one note is ever
// current — an older note still inside its window is superseded by a
// newer one, on the dashboard and in the model's prompt alike.
export function currentNote(notes, date) {
  return sortNotes(notes.filter((n) => n.date <= date && date <= n.until))[0] ?? null;
}
