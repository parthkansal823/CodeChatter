import assert from "node:assert/strict";
import { test } from "node:test";

import { seoFindings, type PageSeo } from "./seo";

const good: PageSeo = {
  url: "http://p5173-room.preview.localhost:8080/",
  title: "Orders: everything you sold this week",
  description: "Every order this week, with who bought what and when, and the totals by day, so nothing slips by.",
  canonical: "https://shop.example/orders",
  robots: "index, follow",
  lang: "en",
  viewport: "width=device-width, initial-scale=1",
  charset: "UTF-8",
  favicon: "/favicon.ico",
  headings: [
    { level: 1, text: "Orders" },
    { level: 2, text: "This week" },
    { level: 3, text: "Monday" },
  ],
  images: { total: 2, withoutAlt: [] },
  links: { total: 5, nofollow: 0, withoutText: 0, external: 1 },
  openGraph: { "og:title": "Orders", "og:description": "This week", "og:image": "/og.png" },
  twitter: { "twitter:card": "summary_large_image" },
  jsonLd: ["WebPage"],
  words: 400,
};

test("a page that does it all well has only good things said", () => {
  const found = seoFindings(good);
  assert.ok(found.every((finding) => finding.level === "good"), JSON.stringify(found.filter((finding) => finding.level !== "good")));
  assert.ok(found.some((finding) => finding.text === "One h1."));
});

test("what's missing is a problem, problems first", () => {
  const found = seoFindings({ ...good, title: "", description: null, lang: null, viewport: null, headings: [{ level: 2, text: "x" }], images: { total: 3, withoutAlt: ["a.png", "b.png"] }, links: { ...good.links, withoutText: 1 }, robots: "noindex" });
  const problems = found.filter((finding) => finding.level === "problem").map((finding) => finding.text);
  assert.ok(problems.some((text) => text.startsWith("The page has no title")));
  assert.ok(problems.some((text) => text.startsWith("No meta description")));
  assert.ok(problems.some((text) => text.startsWith("No h1")));
  assert.ok(problems.some((text) => text.startsWith("2 of 3 images have no alt text")));
  assert.ok(problems.some((text) => text.startsWith("1 links have no text")));
  assert.ok(problems.some((text) => text.startsWith("No language")));
  assert.ok(problems.some((text) => text.startsWith("No viewport")));
  assert.ok(problems.some((text) => text.includes("won't list this page")));
  const levels = found.map((finding) => finding.level);
  assert.deepEqual(levels, [...levels].sort((a, b) => ["problem", "advice", "good"].indexOf(a) - ["problem", "advice", "good"].indexOf(b)));
});

test("lengths, headings and previews get advice", () => {
  const found = seoFindings({ ...good, title: "x".repeat(75), description: "Too short.", headings: [{ level: 1, text: "A" }, { level: 1, text: "B" }, { level: 3, text: "Deep" }], openGraph: {}, twitter: {}, canonical: null, words: 20, favicon: null });
  const advice = found.filter((finding) => finding.level === "advice").map((finding) => finding.text);
  assert.ok(advice.includes("The title is 75 characters: search results cut it at about 60."));
  assert.ok(advice.some((text) => text.startsWith("The description is 10 characters")));
  assert.ok(advice.includes("2 h1 headings: one main heading reads best."));
  assert.ok(advice.some((text) => text.startsWith("A heading skips a level: h1 then h3")));
  assert.ok(advice.some((text) => text.includes("og:title, og:description, og:image")));
  assert.ok(advice.some((text) => text.startsWith("No twitter:card")));
  assert.ok(advice.some((text) => text.startsWith("No canonical link")));
  assert.ok(advice.some((text) => text.startsWith("Only 20 words")));
});

test("broken structured data is a problem", () => {
  assert.ok(seoFindings({ ...good, jsonLd: ["Product", "invalid"] }).some((finding) => finding.level === "problem" && finding.text.includes("JSON-LD")));
});
