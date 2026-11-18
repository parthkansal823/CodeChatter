/**
 * The room's browser's SEO tab: what a page tells search engines and link previews (the bridge reads it from the page), checked against the usual
 * advice: a title and a description of a sensible length, one h1 and headings in order, alt text on images, the page's language, a viewport, a
 * canonical address, nothing telling search engines to stay away by mistake, and Open Graph's and Twitter's tags for link previews.
 */

export type PageSeo = {
  url: string;
  title: string;
  description: string | null;
  canonical: string | null;
  robots: string | null;
  lang: string | null;
  viewport: string | null;
  charset: string;
  favicon: string | null;
  headings: Array<{ level: number; text: string }>;
  images: { total: number; withoutAlt: string[] };
  links: { total: number; nofollow: number; withoutText: number; external: number };
  openGraph: Record<string, string>;
  twitter: Record<string, string>;
  jsonLd: string[];
  words: number;
};
export type SeoFinding = { level: "problem" | "advice" | "good"; text: string };

export function seoFindings(page: PageSeo): SeoFinding[] {
  const found: SeoFinding[] = [];
  const add = (level: SeoFinding["level"], text: string) => found.push({ level, text });
  const title = page.title.trim();
  if (!title) add("problem", "The page has no title: search results and tabs show its address instead.");
  else if (title.length > 60) add("advice", `The title is ${title.length} characters: search results cut it at about 60.`);
  else if (title.length < 10) add("advice", `The title is only ${title.length} characters: say what the page is.`);
  else add("good", `A title of ${title.length} characters.`);
  const description = page.description?.trim() ?? "";
  if (!description) add("problem", 'No meta description: search results make one up from the page. Add <meta name="description" content="…">.');
  else if (description.length < 50 || description.length > 160) add("advice", `The description is ${description.length} characters: 50 to 160 shows whole in search results.`);
  else add("good", `A description of ${description.length} characters.`);
  const h1s = page.headings.filter((heading) => heading.level === 1);
  if (h1s.length === 0) add("problem", "No h1: the page has no main heading.");
  else if (h1s.length > 1) add("advice", `${h1s.length} h1 headings: one main heading reads best.`);
  else add("good", "One h1.");
  for (let i = 1; i < page.headings.length; i += 1) {
    const [before, now] = [page.headings[i - 1]!, page.headings[i]!];
    if (now.level > before.level + 1) {
      add("advice", `A heading skips a level: h${before.level} then h${now.level} ("${now.text.slice(0, 40)}").`);
      break;
    }
  }
  if (page.images.withoutAlt.length) add("problem", `${page.images.withoutAlt.length} of ${page.images.total} images have no alt text: screen readers and image search can't tell what they are.`);
  else if (page.images.total) add("good", `Every image (${page.images.total}) has alt text.`);
  if (page.links.withoutText) add("problem", `${page.links.withoutText} links have no text: say where each one goes.`);
  if (!page.lang) add("problem", 'No language on <html>: add lang="en" (or the page\'s own).');
  if (!page.viewport) add("problem", "No viewport meta tag: phones show the page zoomed out.");
  if (!page.canonical) add("advice", "No canonical link: if the page has more than one address, search engines may split it.");
  if (page.robots && /noindex/i.test(page.robots)) add("problem", `robots says "${page.robots}": search engines won't list this page.`);
  const og = (name: string) => page.openGraph[`og:${name}`];
  const missingOg = ["title", "description", "image"].filter((name) => !og(name));
  if (missingOg.length) add("advice", `For link previews, add Open Graph's ${missingOg.map((name) => `og:${name}`).join(", ")}.`);
  else add("good", "Open Graph's title, description and image, for link previews.");
  if (!page.twitter["twitter:card"]) add("advice", "No twitter:card: X shows a plain link.");
  if (page.jsonLd.includes("invalid")) add("problem", "Some structured data (JSON-LD) isn't valid JSON.");
  else if (page.jsonLd.length) add("good", `Structured data: ${page.jsonLd.join(", ")}.`);
  if (!page.favicon) add("advice", "No favicon.");
  if (page.words < 100) add("advice", `Only ${page.words} words: search engines have little to go on.`);
  // Problems first, then advice, then what's good.
  const order = { problem: 0, advice: 1, good: 2 };
  return found.sort((a, b) => order[a.level] - order[b.level]);
}
