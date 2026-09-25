import { test } from "node:test";
import assert from "node:assert/strict";
import { currentNote, isNoteFile, parseNote, sortNotes } from "./notes-lib.mjs";

const note = (header, body = "One.\n") => `---\n${header}\n---\n${body}`;
const HEADER = "title: Fed cuts 50bp\ndate: 2026-09-24\nuntil: 2026-10-08";

test("parses the header and splits the body into joined paragraphs", () => {
  const n = parseNote(
    note(HEADER, "\nThe Fed cut by 50bp,\ntwice what was priced.\n\n\nMarkets took it as a growth scare.\n"),
    "2026-09-24-fed.md",
  );
  assert.deepEqual(n, {
    file: "2026-09-24-fed.md",
    title: "Fed cuts 50bp",
    date: "2026-09-24",
    until: "2026-10-08",
    body: ["The Fed cut by 50bp, twice what was priced.", "Markets took it as a growth scare."],
  });
});

test("accepts CRLF line endings, a BOM and quoted values", () => {
  const n = parseNote(
    "﻿---\r\ntitle: \"Oil: the supply shock\"\r\ndate: 2026-09-24\r\nuntil: 2026-09-24\r\n---\r\nA.\r\n\r\nB.\r\n",
    "x.md",
  );
  assert.equal(n.title, "Oil: the supply shock");
  assert.deepEqual(n.body, ["A.", "B."]);
});

test("rejects malformed notes, naming the file", () => {
  const bad = [
    ["no header", "just text", /missing front matter/],
    ["missing until", note("title: T\ndate: 2026-09-24"), /missing "until"/],
    ["unknown key", note(`${HEADER}\nexpires: 2026-10-01`), /unknown header "expires"/],
    ["bad date", note("title: T\ndate: 2026-9-24\nuntil: 2026-10-08"), /"date" must be a YYYY-MM-DD/],
    ["impossible date", note("title: T\ndate: 2026-02-30\nuntil: 2026-10-08"), /"date" must be/],
    ["until before date", note("title: T\ndate: 2026-09-24\nuntil: 2026-09-23"), /before "date"/],
    ["empty body", note(HEADER, "\n\n"), /empty body/],
    ["long title", note(`title: ${"x".repeat(121)}\ndate: 2026-09-24\nuntil: 2026-10-08`), /title longer/],
  ];
  for (const [label, text, re] of bad) {
    assert.throws(() => parseNote(text, "bad.md"), (e) => re.test(e.message) && e.message.startsWith("bad.md: "), label);
  }
});

test("only non-README markdown files are notes", () => {
  assert.equal(isNoteFile("2026-09-24-fed.md"), true);
  assert.equal(isNoteFile("README.md"), false);
  assert.equal(isNoteFile("draft.txt"), false);
});

test("a note is current from its date through its until, inclusive", () => {
  const n = { file: "a.md", title: "A", date: "2026-09-24", until: "2026-09-26", body: ["x"] };
  assert.equal(currentNote([n], "2026-09-23"), null);
  assert.equal(currentNote([n], "2026-09-24"), n);
  assert.equal(currentNote([n], "2026-09-26"), n);
  assert.equal(currentNote([n], "2026-09-27"), null);
  assert.equal(currentNote([], "2026-09-24"), null);
});

test("only the newest in-window note is current; expired ones never are", () => {
  const mk = (file, date, until) => ({ file, title: file, date, until, body: ["x"] });
  const oil = mk("oil.md", "2026-09-20", "2026-10-31");
  const fed = mk("fed.md", "2026-09-24", "2026-10-08");
  const newerButExpired = mk("cpi.md", "2026-09-25", "2026-09-25");
  assert.equal(currentNote([oil, fed, newerButExpired], "2026-09-26"), fed);
  assert.equal(currentNote([oil, fed], "2026-09-22"), oil);
});

test("notes sort newest first, ties broken by file name", () => {
  const mk = (file, date) => ({ file, title: file, date, until: "2026-12-31", body: ["x"] });
  const sorted = sortNotes([mk("a.md", "2026-09-01"), mk("b.md", "2026-09-10"), mk("c.md", "2026-09-10")]);
  assert.deepEqual(sorted.map((n) => n.file), ["c.md", "b.md", "a.md"]);
});
