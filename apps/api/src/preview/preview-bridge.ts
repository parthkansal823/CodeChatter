/**
 * The script the preview proxy puts in a dev server's pages when the room's browser shows them in a frame (preview-proxy.ts): it tells the room, by
 * postMessage to the app's origin only, where the page is, what its console says, each request it makes, its Web Vitals as the browser measures them,
 * and, in "click to code", which element was clicked and where in the code it comes from (React, Vue and Svelte say in their development builds; a
 * dev-server plugin's data attribute too). Asked, it gives its SEO (meta tags, headings, images, links, structured data), its storage, its DOM as a
 * tree, and runs JavaScript, as DevTools' console does. It takes what to do from the room, and from nowhere else. Plain JavaScript, run in the page.
 */
export function previewBridge(appOrigin: string): string {
  return `(() => {
  if (window.__codechatterBridge || window.parent === window) return;
  window.__codechatterBridge = true;
  const PARENT = ${JSON.stringify(appOrigin)};
  let sent = 0;
  const post = (type, data) => {
    // A page that logs in a loop doesn't flood the room.
    if (++sent > 5000) return;
    try { window.parent.postMessage({ source: "codechatter-preview", type, ...data }, PARENT); } catch {}
  };

  // ---- Where the page is ----
  const where = () => post("location", { href: location.href, title: document.title });
  for (const name of ["pushState", "replaceState"]) {
    const original = history[name];
    history[name] = function (...args) { const out = original.apply(this, args); setTimeout(where); return out; };
  }
  addEventListener("popstate", where);
  addEventListener("hashchange", where);
  addEventListener("DOMContentLoaded", where);
  addEventListener("load", where);
  where();

  // ---- The console ----
  const describe = (value, depth = 0) => {
    if (value instanceof Error) return (value.stack || value.name + ": " + value.message).slice(0, 4000);
    if (typeof value === "string") return value.slice(0, 4000);
    if (value === undefined) return "undefined";
    if (typeof value === "function") return "function " + (value.name || "") + "()";
    if (typeof value === "symbol" || typeof value === "bigint") return String(value);
    if (value instanceof Element) return "<" + value.tagName.toLowerCase() + (value.id ? "#" + value.id : "") + ">";
    try {
      const seen = new WeakSet();
      return JSON.stringify(value, (key, item) => {
        if (item && typeof item === "object") { if (seen.has(item)) return "[circular]"; seen.add(item); }
        return typeof item === "bigint" ? String(item) : item;
      }, depth ? 0 : 2).slice(0, 4000);
    } catch { return String(value).slice(0, 4000); }
  };
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const original = console[level];
    console[level] = function (...args) {
      post("console", { level, text: args.map((arg) => describe(arg)).join(" ") });
      return original.apply(this, args);
    };
  }
  addEventListener("error", (event) => {
    // A script, image or stylesheet that failed to load is the network's to show.
    if (event.target && event.target !== window && event.target.tagName) {
      post("resource", { url: event.target.src || event.target.href || "", initiator: event.target.tagName.toLowerCase(), failed: true });
      return;
    }
    post("console", { level: "error", text: describe(event.error || event.message) + (event.filename ? "\\n    at " + event.filename + ":" + event.lineno + ":" + event.colno : "") });
  }, true);
  addEventListener("unhandledrejection", (event) => post("console", { level: "error", text: "Unhandled promise rejection: " + describe(event.reason) }));

  // ---- The network ----
  let ids = 0;
  const absolute = (url) => { try { return new URL(url, location.href).href; } catch { return String(url); } };
  const nativeFetch = window.fetch;
  if (nativeFetch) {
    window.fetch = function (input, init) {
      const id = ++ids;
      const started = performance.now();
      const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
      post("request", { id, method, url: absolute(typeof input === "string" || input instanceof URL ? input : input.url), initiator: "fetch" });
      return nativeFetch.apply(this, arguments).then((response) => {
        post("response", { id, status: response.status, ok: response.ok, contentType: response.headers.get("content-type") || "", size: Number(response.headers.get("content-length")) || null, durationMs: Math.round(performance.now() - started) });
        return response;
      }, (error) => {
        post("response", { id, failed: true, error: String(error && error.message || error), durationMs: Math.round(performance.now() - started) });
        throw error;
      });
    };
  }
  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) { this.__cc = { method: String(method).toUpperCase(), url: absolute(url) }; return open.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    const meta = this.__cc;
    if (meta) {
      const id = ++ids;
      const started = performance.now();
      post("request", { id, method: meta.method, url: meta.url, initiator: "xhr" });
      this.addEventListener("loadend", () => post("response", { id, status: this.status, ok: this.status >= 200 && this.status < 400, failed: this.status === 0, contentType: this.getResponseHeader("content-type") || "", size: Number(this.getResponseHeader("content-length")) || null, durationMs: Math.round(performance.now() - started) }));
    }
    return send.apply(this, arguments);
  };
  // Everything else the page loads: scripts, styles, images, fonts, and the page itself.
  const resource = (entry) => {
    // Requests made in code are reported as they're made; the room's own script isn't the page's.
    if (entry.initiatorType === "fetch" || entry.initiatorType === "xmlhttprequest" || entry.name.includes("/__cc/")) return;
    post("resource", { url: entry.name, initiator: entry.initiatorType || "other", status: entry.responseStatus || null, size: entry.transferSize || entry.encodedBodySize || null, durationMs: Math.round(entry.duration) });
  };
  try {
    new PerformanceObserver((list) => list.getEntries().forEach(resource)).observe({ type: "resource", buffered: true });
    const page = performance.getEntriesByType("navigation")[0];
    if (page) addEventListener("load", () => setTimeout(() => post("resource", { url: location.href, initiator: "document", status: page.responseStatus || null, size: page.transferSize || page.encodedBodySize || null, durationMs: Math.round(page.duration || page.responseEnd) })));
  } catch {}

  // ---- Click to code ----
  const LINE = /(?:\\(|@|\\s|^)((?:https?:\\/\\/|webpack-internal:\\/\\/\\/|file:\\/\\/|\\/)[^\\s()]+?):(\\d+):(\\d+)\\)?\\s*$/;
  const LIBRARY = /node_modules|react-dom|react\\.development|jsx-dev-runtime|jsx-runtime|\\/@vite\\/|\\/@react-refresh|\\/\\.vite\\/deps\\/|chunk-[A-Z0-9]{6,}|scheduler/;
  const fromStack = (stack) => {
    for (const line of String(stack || "").split("\\n").slice(1)) {
      const match = LINE.exec(line.trim());
      if (match && !LIBRARY.test(match[1])) return { file: match[1], line: Number(match[2]), column: Number(match[3]) };
    }
    return null;
  };
  const nameOf = (type) => (type && (type.displayName || type.name)) || (typeof type === "string" ? type : null);
  const reactSource = (node) => {
    const key = Object.keys(node).find((name) => name.startsWith("__reactFiber$"));
    if (!key) return null;
    let firstComponent = null;
    for (let fiber = node[key]; fiber; fiber = fiber.return) {
      if (!firstComponent && typeof fiber.type === "function") firstComponent = nameOf(fiber.type);
      // React 18 and before, with the development JSX transform: the exact place.
      if (fiber._debugSource) return { framework: "react", component: nameOf(fiber._debugOwner && fiber._debugOwner.type) || firstComponent, file: fiber._debugSource.fileName, line: fiber._debugSource.lineNumber, column: fiber._debugSource.columnNumber || 1 };
      // React 19: where the element was made, from its stack.
      if (fiber._debugStack) {
        const found = fromStack(fiber._debugStack.stack || fiber._debugStack);
        if (found) return { framework: "react", component: nameOf(fiber._debugOwner && fiber._debugOwner.type) || firstComponent, ...found };
      }
    }
    return firstComponent ? { framework: "react", component: firstComponent } : null;
  };
  const ATTRIBUTES = ["data-insp-path", "data-cc-source", "data-source", "data-locator", "data-v-inspector"];
  const sourceOf = (element) => {
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      for (const name of ATTRIBUTES) {
        const value = node.getAttribute(name);
        const match = value && /^(.+?):(\\d+)(?::(\\d+))?/.exec(value);
        if (match) return { framework: "attribute", file: match[1], line: Number(match[2]), column: Number(match[3] || 1) };
      }
      if (node.__svelte_meta && node.__svelte_meta.loc) return { framework: "svelte", file: node.__svelte_meta.loc.file, line: node.__svelte_meta.loc.line + 1, column: node.__svelte_meta.loc.column + 1 };
      const vue = node.__vueParentComponent;
      if (vue && vue.type && vue.type.__file) return { framework: "vue", component: vue.type.__name || vue.type.name || null, file: vue.type.__file };
      const react = reactSource(node);
      if (react && react.file) return react;
      if (react && node === element) element.__ccComponent = react.component;
    }
    return element.__ccComponent ? { framework: "react", component: element.__ccComponent } : null;
  };
  const selectorOf = (element) => {
    const parts = [];
    for (let node = element; node && node.nodeType === 1 && parts.length < 5; node = node.parentElement) {
      let part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(part + "#" + node.id); break; }
      if (node.classList.length) part += "." + [...node.classList].slice(0, 2).join(".");
      parts.unshift(part);
    }
    return parts.join(" > ");
  };
  const infoOf = (element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      classes: [...element.classList].slice(0, 12),
      text: (element.innerText || element.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 120),
      selector: selectorOf(element),
      size: { width: Math.round(box.width), height: Math.round(box.height) },
      styles: { display: style.display, position: style.position, color: style.color, background: style.backgroundColor, font: style.fontSize + " " + style.fontFamily.split(",")[0], margin: style.margin, padding: style.padding },
      attributes: [...element.attributes].filter((attribute) => !ATTRIBUTES.includes(attribute.name) && attribute.name !== "class" && attribute.name !== "style").slice(0, 12).map((attribute) => [attribute.name, attribute.value.slice(0, 200)]),
      page: location.pathname,
      source: sourceOf(element),
    };
  };
  let inspecting = false;
  let box = null;
  let label = null;
  const highlight = (element) => {
    if (!box) {
      box = document.createElement("div");
      box.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #f97316;background:rgba(249,115,22,.12);border-radius:2px;transition:all 40ms";
      label = document.createElement("div");
      label.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;background:#111;color:#fff;font:12px/1.4 ui-monospace,monospace;padding:2px 6px;border-radius:3px;max-width:60vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
      document.documentElement.append(box, label);
    }
    const rect = element.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: rect.left + "px", top: rect.top + "px", width: rect.width + "px", height: rect.height + "px" });
    const source = sourceOf(element);
    const file = source && source.file ? String(source.file).split(/[\\\\/]/).pop().split("?")[0] + (source.line ? ":" + source.line : "") : "";
    label.textContent = (source && source.component ? source.component + " · " : "") + element.tagName.toLowerCase() + (file ? " · " + file : "") + " · " + Math.round(rect.width) + "×" + Math.round(rect.height);
    Object.assign(label.style, { display: "block", left: Math.max(0, rect.left) + "px", top: (rect.top > 24 ? rect.top - 22 : rect.bottom + 4) + "px" });
  };
  const hide = () => { if (box) { box.style.display = "none"; label.style.display = "none"; } };
  const onMove = (event) => { if (event.target instanceof Element && event.target !== box) highlight(event.target); };
  const onClick = (event) => {
    if (!(event.target instanceof Element)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    post("inspected", { element: infoOf(event.target) });
    setInspecting(false);
  };
  const swallow = (event) => { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); };
  const onKey = (event) => { if (event.key === "Escape") setInspecting(false); };
  const setInspecting = (on) => {
    if (on === inspecting) return;
    inspecting = on;
    const method = on ? addEventListener : removeEventListener;
    method("mousemove", onMove, true);
    method("click", onClick, true);
    method("mousedown", swallow, true);
    method("mouseup", swallow, true);
    method("keydown", onKey, true);
    document.documentElement.style.cursor = on ? "crosshair" : "";
    if (!on) hide();
    post("inspect", { on });
  };


  // ---- Web Vitals, as the page's own browser measures them ----
  const vitals = {};
  let vitalsTimer = 0;
  const sendVitals = () => { clearTimeout(vitalsTimer); vitalsTimer = setTimeout(() => post("vitals", { vitals: { ...vitals } }), 250); };
  const watch = (type, take, options = {}) => { try { new PerformanceObserver((list) => { list.getEntries().forEach(take); sendVitals(); }).observe({ type, buffered: true, ...options }); } catch {} };
  try {
    const page = performance.getEntriesByType("navigation")[0];
    if (page) { vitals.ttfb = Math.round(page.responseStart); sendVitals(); }
  } catch {}
  watch("paint", (entry) => { if (entry.name === "first-contentful-paint") vitals.fcp = Math.round(entry.startTime); });
  watch("largest-contentful-paint", (entry) => { vitals.lcp = Math.round(entry.startTime); vitals.lcpElement = entry.element ? entry.element.tagName.toLowerCase() + (entry.element.id ? "#" + entry.element.id : "") : null; });
  let cls = 0;
  watch("layout-shift", (entry) => { if (!entry.hadRecentInput) { cls += entry.value; vitals.cls = Math.round(cls * 1000) / 1000; } });
  // INP: the slowest interaction so far, as each interaction's longest event.
  const interactions = new Map();
  watch("event", (entry) => {
    if (!entry.interactionId) return;
    interactions.set(entry.interactionId, Math.max(interactions.get(entry.interactionId) || 0, entry.duration));
    vitals.inp = Math.max(...interactions.values());
    vitals.interactions = interactions.size;
  }, { durationThreshold: 16 });
  watch("longtask", (entry) => { vitals.longTasks = (vitals.longTasks || 0) + 1; vitals.longestTask = Math.max(vitals.longestTask || 0, Math.round(entry.duration)); });

  // ---- SEO: what search engines and link previews read ----
  const meta = (selector, attribute = "content") => { const found = document.querySelector(selector); return found ? found.getAttribute(attribute) : null; };
  const seo = () => {
    const tags = (prefix) => Object.fromEntries([...document.querySelectorAll('meta[property^="' + prefix + '"], meta[name^="' + prefix + '"]')].slice(0, 30).map((tag) => [tag.getAttribute("property") || tag.getAttribute("name"), (tag.getAttribute("content") || "").slice(0, 300)]));
    const images = [...document.images];
    const links = [...document.querySelectorAll("a[href]")];
    const jsonLd = [];
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { const data = JSON.parse(script.textContent || ""); [].concat(data).forEach((item) => jsonLd.push(item && item["@type"] ? String(item["@type"]) : "unknown")); } catch { jsonLd.push("invalid"); }
    }
    return {
      url: location.href,
      title: document.title,
      description: meta('meta[name="description"]'),
      canonical: meta('link[rel="canonical"]', "href"),
      robots: meta('meta[name="robots"]'),
      lang: document.documentElement.getAttribute("lang"),
      viewport: meta('meta[name="viewport"]'),
      charset: document.characterSet,
      favicon: meta('link[rel~="icon"]', "href"),
      headings: [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].slice(0, 200).map((heading) => ({ level: Number(heading.tagName[1]), text: (heading.innerText || heading.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 160) })),
      images: { total: images.length, withoutAlt: images.filter((image) => !image.hasAttribute("alt")).slice(0, 50).map((image) => image.currentSrc || image.src || "") },
      links: { total: links.length, nofollow: links.filter((link) => /nofollow/i.test(link.rel)).length, withoutText: links.filter((link) => !(link.innerText || link.textContent || "").trim() && !link.getAttribute("aria-label") && !link.querySelector("img[alt]")).length, external: links.filter((link) => { try { return new URL(link.href).origin !== location.origin; } catch { return false; } }).length },
      openGraph: tags("og:"),
      twitter: tags("twitter:"),
      jsonLd,
      words: (document.body ? document.body.innerText || "" : "").split(/\\s+/).filter(Boolean).length,
    };
  };

  // ---- Storage ----
  const areaOf = (name) => (name === "session" ? sessionStorage : localStorage);
  const storage = () => {
    const read = (area) => { try { return Object.keys(area).slice(0, 500).map((key) => [key, String(area.getItem(key)).slice(0, 2000)]); } catch { return []; } };
    return { local: read(localStorage), session: read(sessionStorage), cookies: document.cookie ? document.cookie.split("; ").slice(0, 200).map((pair) => { const at = pair.indexOf("="); return [decodeURIComponent(pair.slice(0, at)), decodeURIComponent(pair.slice(at + 1)).slice(0, 2000)]; }) : [] };
  };

  // ---- The DOM, as a tree; a node is its path of child positions from <html> ----
  const MOST_NODES = 4000;
  const tree = () => {
    let count = 0;
    const walk = (element, depth) => {
      count += 1;
      const children = [];
      if (depth < 40) for (const child of element.children) { if (count >= MOST_NODES) break; if (child === box || child === label) continue; children.push(walk(child, depth + 1)); }
      const own = [...element.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join(" ").trim().replace(/\\s+/g, " ");
      return { tag: element.tagName.toLowerCase(), id: element.id || null, classes: [...element.classList].slice(0, 4), text: own.slice(0, 80), children };
    };
    return { root: walk(document.documentElement, 0), cut: count >= MOST_NODES };
  };
  const byPath = (path) => {
    let node = document.documentElement;
    for (const index of path || []) { node = node && [...node.children].filter((child) => child !== box && child !== label)[index]; }
    return node || null;
  };

  // ---- Running JavaScript in the page, as DevTools' console does ----
  const evaluate = async (id, code) => {
    try {
      let value = (0, eval)(code);
      if (value && typeof value.then === "function") value = await value;
      post("evaluated", { id, ok: true, text: describe(value) });
    } catch (error) {
      post("evaluated", { id, ok: false, text: describe(error) });
    }
  };

  // ---- What the room asks ----
  addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== PARENT || !event.data || event.data.source !== "codechatter-room") return;
    const { command } = event.data;
    if (command === "back") history.back();
    else if (command === "forward") history.forward();
    else if (command === "reload") location.reload();
    else if (command === "inspect") setInspecting(Boolean(event.data.on));
    else if (command === "where") where();
    else if (command === "seo") post("seo", { seo: seo() });
    else if (command === "eval") void evaluate(event.data.id, String(event.data.code || ""));
    else if (command === "storage") post("storage", { storage: storage() });
    else if (command === "storage-delete") {
      try {
        if (event.data.area === "cookies") document.cookie = encodeURIComponent(String(event.data.key)) + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
        else areaOf(event.data.area).removeItem(String(event.data.key));
      } catch {}
      post("storage", { storage: storage() });
    } else if (command === "storage-clear") {
      try {
        if (event.data.area === "cookies") document.cookie.split("; ").forEach((pair) => { document.cookie = pair.split("=")[0] + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/"; });
        else areaOf(event.data.area).clear();
      } catch {}
      post("storage", { storage: storage() });
    } else if (command === "dom") post("dom", { dom: tree() });
    else if (command === "dom-hover") { const node = byPath(event.data.path); if (node) highlight(node); }
    else if (command === "dom-leave") hide();
    else if (command === "dom-select") { const node = byPath(event.data.path); if (node) { node.scrollIntoView({ block: "center", behavior: "smooth" }); highlight(node); post("inspected", { element: infoOf(node), from: "tree" }); } }
    else if (command === "vitals") post("vitals", { vitals: { ...vitals } });
  });
  post("ready", {});
})();
`;
}
