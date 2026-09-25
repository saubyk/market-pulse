# Editor's notes

Your own commentary on events moving the markets. Each `.md` file here
(other than this README) is one note. While a note is active it shows on
the dashboard as an **Editor's note** row above "Today's read", and the
daily AI note takes it into account. Details are in SPEC.md §3.9.

```markdown
---
title: Fed cuts 50bp in a surprise move
date: 2026-09-24
until: 2026-10-08
---
The Fed cut by 50bp this afternoon, twice what futures had priced.

Paragraphs are separated by a blank line. Plain text only: Markdown
syntax is shown as typed, not rendered.
```

- **`title`**: the row's headline, up to 120 characters.
- **`date`**: when you wrote it (`YYYY-MM-DD`, UTC). The note shows from this day.
- **`until`**: the last day it is active, inclusive (`YYYY-MM-DD`, UTC). Required, so
  that no note keeps shaping the AI's read after its event has passed.

Only one note shows at a time: if several are within their dates, the newest (by
`date`) is shown and given to the AI, and an older one reappears only if the
newer one expires first. Name files `YYYY-MM-DD-short-slug.md` to keep them in order. To publish a note,
commit it and push to `main`. The deploy puts it on the dashboard, and the next
weekday commentary run (about 22:13 UTC) feeds it to the AI. If a session's note
is already written, it isn't rewritten unless you run the workflow with
`regenerate` ticked. A malformed note fails `npm run build`, so check it locally
first. Expired notes can stay here as a record; they are simply no longer shown.
