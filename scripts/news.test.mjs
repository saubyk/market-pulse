import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeed, parseSources, selectHeadlines } from "./news-lib.mjs";

// Shapes taken from the real feeds: Substack (CDATA everywhere), Drupal
// (plain text, entity-escaped), WordPress (HTML excerpt + boilerplate).
const RSS = `<?xml version="1.0"?><rss version="2.0"><channel>
<title>Feed</title><link>https://example.org</link>
<atom:link href="https://example.org/feed" rel="self" type="application/rss+xml"/>
<item><title><![CDATA[Strait of Hormuz: Iran tightens control]]></title>
<description><![CDATA[Tanker traffic slowed.]]></description>
<link>https://example.org/p/hormuz</link><pubDate>Tue, 13 Oct 2026 20:55:31 GMT</pubDate></item>
<item>
  <title>Gaza &amp; the West Bank: a digest</title>
  <link>https://example.org/content/digest/1</link>
  <description>
  A monthly digest of key developments.</description>
  <pubDate>Tue, 13 Oct 2026 17:19:43 +0000</pubDate>
</item>
<item><title>NATO&#8217;s spending push</title>
<link>https://example.org/nato/</link>
<pubDate>Fri, 09 Oct 2026 19:36:03 +0000</pubDate>
<description><![CDATA[<p>Students are taking to the streets. But [&#8230;]</p>
<p>The post <a href="https://example.org/nato/">NATO</a> appeared first on Example.</p>]]></description></item>
<item><title>No date</title><link>https://example.org/nodate</link></item>
<item><title></title><link>https://example.org/untitled</link></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><title>A</title>
<entry><title type="html">Red Sea &lt;b&gt;shipping&lt;/b&gt; rerouted</title>
<link rel="enclosure" href="https://example.net/img.jpg"/>
<link rel="alternate" href="https://example.net/red-sea?a=1&amp;b=2"/>
<published>2026-10-13T08:00:00Z</published><updated>2026-10-13T09:00:00Z</updated>
<summary>Insurers raised premiums.</summary></entry></feed>`;

test("parseFeed reads RSS items: CDATA, entities, HTML and WordPress boilerplate", () => {
  const items = parseFeed(RSS, "Example");
  assert.equal(items.length, 4, "untitled item is dropped");
  assert.deepEqual(items[0], {
    source: "Example",
    title: "Strait of Hormuz: Iran tightens control",
    link: "https://example.org/p/hormuz",
    published: Date.UTC(2026, 9, 13, 20, 55, 31),
    summary: "Tanker traffic slowed.",
  });
  assert.equal(items[1].title, "Gaza & the West Bank: a digest");
  assert.equal(items[1].summary, "A monthly digest of key developments.");
  assert.equal(items[2].title, "NATO’s spending push");
  assert.equal(items[2].summary, "Students are taking to the streets. But…");
  assert.equal(items[3].published, null);
});

test("parseFeed reads Atom entries and picks the alternate link", () => {
  const [e] = parseFeed(ATOM, "Atom");
  assert.equal(e.title, "Red Sea shipping rerouted");
  assert.equal(e.link, "https://example.net/red-sea?a=1&b=2");
  assert.equal(e.published, Date.UTC(2026, 9, 13, 8));
  assert.equal(e.summary, "Insurers raised premiums.");
});

test("parseFeed never throws on garbage", () => {
  assert.deepEqual(parseFeed("<html>not a feed</html>", "x"), []);
  assert.deepEqual(parseFeed("", "x"), []);
});

test("parseFeed truncates long summaries at a word boundary", () => {
  const long = "word ".repeat(200);
  const [it] = parseFeed(`<rss><item><title>t</title><description>${long}</description><pubDate>Tue, 13 Oct 2026 00:00:00 GMT</pubDate></item></rss>`, "x");
  assert.ok(it.summary.length <= 401);
  assert.ok(it.summary.endsWith("word…"));
});

const NOW = Date.UTC(2026, 9, 13, 22);
const H = 3_600_000;
const item = (source, hoursAgo, link = `${source}-${hoursAgo}`) => ({
  source,
  title: `${source} ${hoursAgo}h`,
  link,
  published: NOW - hoursAgo * H,
  summary: "",
});

test("selectHeadlines keeps the window, newest first, without duplicates", () => {
  const out = selectHeadlines(
    [item("A", 80), item("A", 2), item("B", 1), item("B", 3, "A-2"), { ...item("C", 0), published: null }, item("C", -0.5), item("C", -5)],
    NOW,
  );
  // 80h is outside the 72h window; undated and far-future items dropped;
  // the older B item reusing A's link is a duplicate; small clock skew is allowed.
  assert.deepEqual(out.map((i) => i.title), ["C -0.5h", "B 1h", "A 2h"]);
});

test("selectHeadlines caps per source and overall", () => {
  const many = Array.from({ length: 10 }, (_, i) => item("A", i)).concat(Array.from({ length: 10 }, (_, i) => item("B", i + 0.5)));
  const out = selectHeadlines(many, NOW, { perSource: 3, max: 5 });
  assert.equal(out.length, 5);
  assert.ok(out.filter((i) => i.source === "A").length <= 3);
  assert.ok(out.filter((i) => i.source === "B").length <= 3);
});

test("parseSources validates the editor's list", () => {
  assert.deepEqual(parseSources({ sources: [{ name: " A ", feed: "https://a.example/feed" }] }), [
    { name: "A", feed: "https://a.example/feed" },
  ]);
  assert.throws(() => parseSources({}), /expected/);
  assert.throws(() => parseSources({ sources: [{ name: "A", feed: "javascript:alert(1)" }] }), /http\(s\)/);
  assert.throws(() => parseSources({ sources: [{ feed: "https://a.example" }] }), /no "name"/);
  assert.throws(
    () => parseSources({ sources: [{ name: "A", feed: "https://a" }, { name: "A", feed: "https://b" }] }),
    /duplicate/,
  );
});
