import { test } from "node:test";
import assert from "node:assert/strict";
import { currentNote, type EditorNote } from "./notes.ts";

const mk = (file: string, date: string, until: string): EditorNote => ({
  file,
  title: file,
  date,
  until,
  body: ["x"],
});

test("a note shows from its date through its until, by UTC day", () => {
  const n = mk("fed.md", "2026-09-24", "2026-09-26");
  assert.equal(currentNote([n], new Date("2026-09-23T23:59:59Z")), null);
  assert.equal(currentNote([n], new Date("2026-09-24T00:00:00Z")), n);
  assert.equal(currentNote([n], new Date("2026-09-26T23:59:59Z")), n);
  assert.equal(currentNote([n], new Date("2026-09-27T00:00:00Z")), null);
});

test("nothing to show without notes", () => {
  assert.equal(currentNote([], new Date("2026-09-25T12:00:00Z")), null);
});

test("with several in their window, only the newest shows", () => {
  const notes = [
    mk("old.md", "2026-09-01", "2026-09-10"),
    mk("oil.md", "2026-09-20", "2026-10-31"),
    mk("fed.md", "2026-09-24", "2026-10-08"),
  ];
  assert.equal(currentNote(notes, new Date("2026-09-25T12:00:00Z"))?.file, "fed.md");
  // Once the newest expires, the older one still in its window comes back.
  assert.equal(currentNote(notes, new Date("2026-10-09T12:00:00Z"))?.file, "oil.md");
});
