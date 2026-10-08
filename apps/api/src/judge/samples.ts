/**
 * Sample tests from competitive-programming problem pages. Only these hosts
 * are fetched (fixed allow-list, https only), so this can't be used to reach
 * anything else from the server.
 */
export type ImportedProblem = { title: string; samples: Array<{ input: string; output: string }> };

const HOSTS = new Set(["codeforces.com", "www.codeforces.com", "atcoder.jp", "cses.fi"]);

export function isImportableUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return url.protocol === "https:" && HOSTS.has(url.hostname) ? url : null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** The text inside a <pre>: line breaks from <br> and block elements, tags dropped, entities decoded. */
export function preText(html: string): string {
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>\s*/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (entity, name: string) => {
      if (name.startsWith("#x")) return String.fromCodePoint(parseInt(name.slice(2), 16));
      if (name.startsWith("#") && name !== "#39") return String.fromCodePoint(parseInt(name.slice(1), 10));
      return ENTITIES[name.toLowerCase()] ?? entity;
    });
  return `${text.replace(/\r/g, "").replace(/^\n+/, "").replace(/\s+$/, "")}\n`;
}

const allPre = (html: string) => [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)].map((m) => preText(m[1]!));

function title(html: string): string {
  const raw = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "Problem";
  return preText(raw).trim().replace(/\s+/g, " ").slice(0, 120);
}

export function parseCodeforces(html: string): ImportedProblem {
  const samples: ImportedProblem["samples"] = [];
  for (const block of html.split('<div class="sample-test">').slice(1)) {
    const inputs = [...block.matchAll(/<div class="input">[\s\S]*?<pre[^>]*>([\s\S]*?)<\/pre>/gi)].map((m) => preText(m[1]!));
    const outputs = [...block.matchAll(/<div class="output">[\s\S]*?<pre[^>]*>([\s\S]*?)<\/pre>/gi)].map((m) => preText(m[1]!));
    inputs.forEach((input, i) => samples.push({ input, output: outputs[i] ?? "" }));
  }
  return { title: title(html), samples };
}

export function parseAtCoder(html: string): ImportedProblem {
  // English section only (the page repeats every sample in Japanese).
  const english = /<span class="lang-en">([\s\S]*?)<\/span>\s*<\/div>\s*<\/div>|<span class="lang-en">([\s\S]*)/i.exec(html);
  const section = english?.[1] ?? english?.[2] ?? html;
  const inputs = [...section.matchAll(/<h3>\s*Sample Input \d+\s*<\/h3>\s*<pre[^>]*>([\s\S]*?)<\/pre>/gi)].map((m) => preText(m[1]!));
  const outputs = [...section.matchAll(/<h3>\s*Sample Output \d+\s*<\/h3>\s*<pre[^>]*>([\s\S]*?)<\/pre>/gi)].map((m) => preText(m[1]!));
  return { title: title(html), samples: inputs.map((input, i) => ({ input, output: outputs[i] ?? "" })) };
}

export function parseCses(html: string): ImportedProblem {
  // "Input:" then <pre>, "Output:" then <pre>, repeated per example.
  const inputs = [...html.matchAll(/Input:\s*<\/(?:p|b|strong)>\s*(?:<\/p>\s*)?<pre[^>]*>([\s\S]*?)<\/pre>/gi)].map((m) => preText(m[1]!));
  const outputs = [...html.matchAll(/Output:\s*<\/(?:p|b|strong)>\s*(?:<\/p>\s*)?<pre[^>]*>([\s\S]*?)<\/pre>/gi)].map((m) => preText(m[1]!));
  if (inputs.length === 0) {
    const pres = allPre(html);
    for (let i = 0; i + 1 < pres.length; i += 2) inputs.push(pres[i]!), outputs.push(pres[i + 1]!);
  }
  return { title: title(html), samples: inputs.map((input, i) => ({ input, output: outputs[i] ?? "" })) };
}

export function parseProblem(url: URL, html: string): ImportedProblem {
  if (url.hostname.endsWith("codeforces.com")) return parseCodeforces(html);
  if (url.hostname === "atcoder.jp") return parseAtCoder(html);
  return parseCses(html);
}
