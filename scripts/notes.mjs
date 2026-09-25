#!/usr/bin/env node
// Compiles the editor's notes (SPEC §3.9) from notes/*.md into
// public/data/notes.json, which the dashboard fetches:
//
//   node scripts/notes.mjs
//
// Runs before `npm run dev` and every build, so a note pushed to main is
// live with that deploy. The output is a build artifact (gitignored).
// A malformed note exits 1 with the file and the problem, which fails
// the build instead of shipping a broken note.

import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { NOTES_DIR, NOTES_JSON_PATH, isNoteFile, parseNote, sortNotes } from "./notes-lib.mjs";

// Every note in `dir`, parsed and validated, newest first. A missing
// directory is no notes. Also used by scripts/commentary.mjs.
export async function readNotes(dir = NOTES_DIR) {
  let names;
  try {
    names = await readdir(dir);
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  const notes = [];
  for (const name of names.filter(isNoteFile).sort()) {
    notes.push(parseNote(await readFile(join(dir, name), "utf8"), name));
  }
  return sortNotes(notes);
}

async function main() {
  const notes = await readNotes();
  await mkdir(dirname(NOTES_JSON_PATH), { recursive: true });
  await writeFile(NOTES_JSON_PATH, JSON.stringify(notes, null, 2) + "\n");
  console.log(`notes: ${notes.length} compiled into ${NOTES_JSON_PATH}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
