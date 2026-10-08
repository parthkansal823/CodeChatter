/**
 * Turns a room's HTML file into one self-contained document for the preview
 * iframe: linked stylesheets, scripts and SVG images are read from the room's
 * files and inlined. The iframe has an opaque origin (sandbox without
 * allow-same-origin), so the page can't load relative URLs on its own, and
 * above all it can't act as the viewer against the app.
 */

export type ReadFile = (path: string) => string | undefined;

/** Resolve `href` relative to the folder of `from` (both workspace-relative). */
export function resolvePath(from: string, href: string): string | null {
  if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return null; // absolute URL, protocol-relative, or anchor
  const clean = href.split(/[?#]/)[0]!;
  if (!clean) return null;
  const parts = clean.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const segment of clean.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

// Written into the page first: forwards console output, errors and clicks on
// relative links to the parent window (the only channel out of the sandbox).
const BRIDGE = `(() => {
  const post = (message) => parent.postMessage(Object.assign({ __ccPreview: true }, message), "*");
  const show = (value) => {
    if (typeof value === "string") return value;
    if (value instanceof Error) return value.stack || value.message;
    try { return JSON.stringify(value, null, 1); } catch { return String(value); }
  };
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const original = console[level];
    console[level] = (...args) => { post({ level, text: args.map(show).join(" ") }); original.apply(console, args); };
  }
  addEventListener("error", (e) => post({ level: "error", text: e.message + (e.lineno ? " (line " + e.lineno + ")" : "") }));
  addEventListener("unhandledrejection", (e) => post({ level: "error", text: "Unhandled rejection: " + show(e.reason) }));
  document.addEventListener("click", (e) => {
    const link = e.target instanceof Element ? e.target.closest("a[href]") : null;
    const href = link && link.getAttribute("href");
    if (!href || /^([a-z][a-z0-9+.-]*:|\\/\\/|#)/i.test(href)) return;
    e.preventDefault();
    post({ navigate: href });
  }, true);
})();`;

const escapeFor = (tag: "script" | "style", text: string) => text.replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);

export function buildPreviewDocument(entry: string, read: ReadFile): { html: string; missing: string[] } {
  const source = read(entry) ?? "";
  const missing: string[] = [];
  const doc = new DOMParser().parseFromString(source, "text/html");

  const bridge = doc.createElement("script");
  bridge.textContent = BRIDGE;
  doc.head.prepend(bridge);

  for (const link of Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]'))) {
    const path = resolvePath(entry, link.getAttribute("href")!);
    if (!path) continue;
    const css = read(path);
    if (css === undefined) {
      missing.push(path);
      continue;
    }
    const style = doc.createElement("style");
    style.setAttribute("data-cc-source", path);
    style.textContent = escapeFor("style", css);
    link.replaceWith(style);
  }

  for (const script of Array.from(doc.querySelectorAll<HTMLScriptElement>("script[src]"))) {
    const path = resolvePath(entry, script.getAttribute("src")!);
    if (!path) continue;
    const js = read(path);
    if (js === undefined) {
      missing.push(path);
      continue;
    }
    const inline = doc.createElement("script");
    for (const attribute of Array.from(script.attributes)) if (attribute.name !== "src") inline.setAttribute(attribute.name, attribute.value);
    inline.setAttribute("data-cc-source", path);
    // sourceURL names the file in stack traces and the console.
    inline.textContent = `${escapeFor("script", js)}\n//# sourceURL=${path}`;
    script.replaceWith(inline);
  }

  for (const image of Array.from(doc.querySelectorAll<HTMLImageElement>("img[src]"))) {
    const path = resolvePath(entry, image.getAttribute("src")!);
    if (!path || !path.toLowerCase().endsWith(".svg")) continue;
    const svg = read(path);
    if (svg !== undefined) image.setAttribute("src", `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  }

  return { html: `<!doctype html>\n${doc.documentElement.outerHTML}`, missing };
}
