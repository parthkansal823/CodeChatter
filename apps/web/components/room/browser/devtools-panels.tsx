/**
 * The room's browser's DevTools panels, below the page: the Console (and running JavaScript in the page), the Network (by type, each request's
 * details), the Elements (the page's DOM as a tree, and the element picked, with its code), Performance (Web Vitals as the browser measures them),
 * SEO (seo.ts), and Application (the page's storage and cookies). browser-pane.tsx holds what the page has said and passes it here.
 */
"use client";

import { ChevronDown, ChevronRight, Code2, RotateCw, Trash2 } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { seoFindings, type PageSeo } from "./seo";
import type { CodePlace, InspectedElement } from "./source-map";

export type ConsoleEntry = { n: number; level: string; text: string };
export type NetworkEntry = { key: string; method: string; url: string; initiator: string; status: number | null; failed: boolean; size: number | null; durationMs: number | null; contentType?: string };
export type DomNode = { tag: string; id: string | null; classes: string[]; text: string; children: DomNode[] };
export type Vitals = { lcp?: number; lcpElement?: string | null; cls?: number; inp?: number; interactions?: number; fcp?: number; ttfb?: number; longTasks?: number; longestTask?: number };
export type PageStorage = { local: Array<[string, string]>; session: Array<[string, string]>; cookies: Array<[string, string]> };

export const sizeOf = (bytes: number | null) => (bytes === null ? "" : bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} kB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
export const pathOf = (href: string) => {
  try {
    const url = new URL(href);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return href;
  }
};
const empty = (words: string) => <p className="p-2 text-muted-foreground">{words}</p>;

// ---- Console ----
export function ConsolePanel({ entries, onRun }: { entries: ConsoleEntry[]; onRun: (code: string) => void }) {
  const [code, setCode] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [back, setBack] = useState(-1);
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && code.trim()) {
      onRun(code);
      setHistory((all) => [code, ...all.filter((each) => each !== code)].slice(0, 50));
      setBack(-1);
      setCode("");
    } else if (event.key === "ArrowUp" && history.length) {
      event.preventDefault();
      const next = Math.min(back + 1, history.length - 1);
      setBack(next);
      setCode(history[next]!);
    } else if (event.key === "ArrowDown" && back >= 0) {
      event.preventDefault();
      const next = back - 1;
      setBack(next);
      setCode(next >= 0 ? history[next]! : "");
    }
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        {entries.length === 0 ? (
          empty("The page's console.log, warnings and errors show here.")
        ) : (
          <ol aria-label="What the page logged" className="font-mono text-[11px]">
            {entries.map((entry) => (
              <li key={entry.n} className={cn("border-b px-2 py-0.5 break-words whitespace-pre-wrap", entry.level === "error" && "bg-destructive/10 text-destructive", entry.level === "warn" && "bg-warning/10", entry.level === "input" && "text-muted-foreground", entry.level === "result" && "text-foreground")}>
                {entry.level === "input" ? `› ${entry.text}` : entry.level === "result" ? `‹ ${entry.text}` : entry.text}
              </li>
            ))}
          </ol>
        )}
      </div>
      <input
        aria-label="Run JavaScript in the page"
        placeholder="› Run JavaScript in the page (Enter; ↑ for the last)"
        spellCheck={false}
        className="h-7 shrink-0 border-t bg-background px-2 font-mono text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        onKeyDown={onKey}
      />
    </div>
  );
}

// ---- Network ----
const TYPES = ["All", "Fetch/XHR", "Doc", "JS", "CSS", "Img", "Font", "Other"] as const;
type RequestType = (typeof TYPES)[number];
export function typeOf(entry: Pick<NetworkEntry, "initiator" | "url">): Exclude<RequestType, "All"> {
  if (entry.initiator === "fetch" || entry.initiator === "xhr") return "Fetch/XHR";
  if (entry.initiator === "document" || entry.initiator === "iframe") return "Doc";
  const path = pathOf(entry.url).split("?")[0]!.toLowerCase();
  if (/\.(m?js|cjs|jsx|tsx?)$/.test(path) || entry.initiator === "script") return "JS";
  if (/\.css$/.test(path)) return "CSS";
  if (/\.(png|jpe?g|gif|svg|webp|avif|ico|bmp)$/.test(path) || entry.initiator === "img" || entry.initiator === "image") return "Img";
  if (/\.(woff2?|ttf|otf|eot)$/.test(path)) return "Font";
  return "Other";
}
export function NetworkPanel({ entries, filter }: { entries: NetworkEntry[]; filter: string }) {
  const [type, setType] = useState<RequestType>("All");
  const [picked, setPicked] = useState<string | null>(null);
  const words = filter.trim().toLowerCase();
  const shown = entries.filter((entry) => (type === "All" || typeOf(entry) === type) && (!words || entry.url.toLowerCase().includes(words)));
  const chosen = entries.find((entry) => entry.key === picked) ?? null;
  const total = shown.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="group" aria-label="Kinds of request" className="flex shrink-0 flex-wrap gap-1 border-b px-2 py-1">
        {TYPES.map((each) => (
          <button key={each} type="button" aria-pressed={type === each} onClick={() => setType(each)} className={cn("rounded px-1.5 py-0.5", type === each ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {each}
          </button>
        ))}
        <span className="ml-auto self-center text-muted-foreground">
          {shown.length} requests · {sizeOf(total) || "0 B"}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {shown.length === 0 ? (
          empty("Every request the page makes shows here: its status, size and time.")
        ) : (
          <table className="w-full text-left font-mono text-[11px]">
            <thead className="sticky top-0 bg-chrome text-muted-foreground">
              <tr>
                <th className="px-2 py-1 font-medium">Name</th>
                <th className="px-2 py-1 font-medium">Status</th>
                <th className="px-2 py-1 font-medium">Type</th>
                <th className="px-2 py-1 text-right font-medium">Size</th>
                <th className="px-2 py-1 text-right font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((entry) => (
                <tr key={entry.key} aria-selected={picked === entry.key} onClick={() => setPicked(picked === entry.key ? null : entry.key)} className={cn("cursor-pointer border-b hover:bg-accent", entry.failed && "text-destructive", picked === entry.key && "bg-accent")}>
                  <td className="max-w-0 truncate px-2 py-0.5" title={entry.url}>
                    {entry.method !== "GET" ? `${entry.method} ` : ""}
                    {pathOf(entry.url) || entry.url}
                  </td>
                  <td className="px-2 py-0.5">{entry.failed && entry.status === null ? "failed" : (entry.status ?? "…")}</td>
                  <td className="px-2 py-0.5">{entry.initiator}</td>
                  <td className="px-2 py-0.5 text-right">{sizeOf(entry.size)}</td>
                  <td className="px-2 py-0.5 text-right">{entry.durationMs === null ? "" : `${entry.durationMs} ms`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {chosen && (
        <section aria-label="The request" className="max-h-28 shrink-0 overflow-auto border-t p-2">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 font-mono text-[11px]">
          <dt className="text-muted-foreground">URL</dt>
          <dd className="break-all">{chosen.url}</dd>
          <dt className="text-muted-foreground">Method</dt>
          <dd>{chosen.method}</dd>
          <dt className="text-muted-foreground">Status</dt>
          <dd>{chosen.failed && chosen.status === null ? "failed" : (chosen.status ?? "waiting")}</dd>
          <dt className="text-muted-foreground">Type</dt>
          <dd>{chosen.contentType || typeOf(chosen)}</dd>
          <dt className="text-muted-foreground">Started by</dt>
          <dd>{chosen.initiator}</dd>
          <dt className="text-muted-foreground">Size</dt>
          <dd>{sizeOf(chosen.size) || "unknown"}</dd>
          <dt className="text-muted-foreground">Time</dt>
          <dd>{chosen.durationMs === null ? "" : `${chosen.durationMs} ms`}</dd>
        </dl>
        </section>
      )}
    </div>
  );
}

// ---- Elements ----
function Node({ node, path, depth, onHover, onLeave, onSelect }: { node: DomNode; path: number[]; depth: number; onHover: (path: number[]) => void; onLeave: () => void; onSelect: (path: number[]) => void }) {
  const [open, setOpen] = useState(depth < 3);
  const label = `<${node.tag}${node.id ? `#${node.id}` : ""}${node.classes.length ? `.${node.classes.join(".")}` : ""}>`;
  return (
    <li>
      <div className="flex items-center hover:bg-accent" style={{ paddingLeft: depth * 12 }} onMouseEnter={() => onHover(path)} onMouseLeave={onLeave}>
        {node.children.length ? (
          <button type="button" aria-label={open ? `Close ${label}` : `Open ${label}`} aria-expanded={open} className="flex size-4 shrink-0 items-center justify-center text-muted-foreground" onClick={() => setOpen(!open)}>
            {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        ) : (
          <span className="size-4 shrink-0" />
        )}
        <button type="button" className="min-w-0 truncate text-left" title="Pick it: what it is, and its code" onClick={() => onSelect(path)} onFocus={() => onHover(path)}>
          <span className="text-brand">{label}</span>
          {node.text && <span className="text-muted-foreground"> {node.text}</span>}
        </button>
      </div>
      {open && node.children.length > 0 && (
        <ul>
          {node.children.map((child, index) => (
            <Node key={index} node={child} path={[...path, index]} depth={depth + 1} onHover={onHover} onLeave={onLeave} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}
export function ElementsPanel({ dom, cut, element, onRefresh, onHover, onLeave, onSelect, onOpenCode }: { dom: DomNode | null; cut: boolean; element: { info: InspectedElement; place: CodePlace | null } | null; onRefresh: () => void; onHover: (path: number[]) => void; onLeave: () => void; onSelect: (path: number[]) => void; onOpenCode: (place: CodePlace) => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1">
        <span className="text-muted-foreground">{dom ? `The page's elements${cut ? " (the first 4,000)" : ""}` : "The page's elements, as a tree."}</span>
        <Button size="icon-xs" variant="ghost" className="ml-auto" aria-label="Read the elements again" title="Read again" onClick={onRefresh}>
          <RotateCw />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto font-mono text-[11px]">{dom ? <ul aria-label="The page's elements">{<Node node={dom} path={[]} depth={0} onHover={onHover} onLeave={onLeave} onSelect={onSelect} />}</ul> : empty("Open the page, and its elements show here.")}</div>
      {element && (
        <section aria-label="The element picked" className="grid max-h-[45%] shrink-0 gap-1.5 overflow-auto border-t p-2">
          <p className="font-mono">
            &lt;{element.info.tag}
            {element.info.id ? `#${element.info.id}` : ""}
            {element.info.classes.length ? `.${element.info.classes.join(".")}` : ""}&gt; · {element.info.size.width}×{element.info.size.height}
          </p>
          {element.info.source?.component && <p>Component: {element.info.source.component}</p>}
          {element.place ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono">
                {element.place.path}:{element.place.line}
              </span>
              <span className="text-muted-foreground">{element.place.by === "source" ? `as the page's ${element.info.source?.framework ?? ""} build says` : `found by its ${element.place.by}`}</span>
              <Button size="xs" variant="outline" onClick={() => onOpenCode(element.place!)}>
                <Code2 /> Go to code
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground">Its code wasn&apos;t found in the room&apos;s files{element.info.source?.file ? ` (the page said ${element.info.source.file})` : ""}.</p>
          )}
          {element.info.text && <p className="text-muted-foreground">“{element.info.text}”</p>}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px]">
            {Object.entries(element.info.styles).map(([name, value]) => (
              <div key={name} className="contents">
                <dt className="text-muted-foreground">{name}</dt>
                <dd className="truncate">{value}</dd>
              </div>
            ))}
            {element.info.attributes.map(([name, value]) => (
              <div key={`attr-${name}`} className="contents">
                <dt className="text-muted-foreground">{name}</dt>
                <dd className="truncate">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}

// ---- Performance ----
/** Google's thresholds: good, then needs improvement, then poor. */
const VITALS: Array<{ key: keyof Vitals; name: string; about: string; good: number; poor: number; unit: "ms" | "" }> = [
  { key: "lcp", name: "Largest Contentful Paint", about: "When the biggest thing on screen was drawn", good: 2500, poor: 4000, unit: "ms" },
  { key: "inp", name: "Interaction to Next Paint", about: "The slowest answer to a click or key so far", good: 200, poor: 500, unit: "ms" },
  { key: "cls", name: "Cumulative Layout Shift", about: "How much the page moved about by itself", good: 0.1, poor: 0.25, unit: "" },
  { key: "fcp", name: "First Contentful Paint", about: "When anything was first drawn", good: 1800, poor: 3000, unit: "ms" },
  { key: "ttfb", name: "Time to First Byte", about: "How long the server took to start answering", good: 800, poor: 1800, unit: "ms" },
];
export function PerformancePanel({ vitals }: { vitals: Vitals }) {
  return (
    <div className="grid content-start gap-2 overflow-auto p-2">
      <p className="text-muted-foreground">Measured by your browser as the page runs here: click about to see Interaction to Next Paint. Lighthouse measures a fresh load, on a phone or a desktop.</p>
      <ul aria-label="Web Vitals" className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
        {VITALS.map((vital) => {
          const value = vitals[vital.key] as number | undefined;
          const rating = value === undefined ? null : value <= vital.good ? "good" : value <= vital.poor ? "needs work" : "poor";
          return (
            <li key={vital.key} className="grid gap-0.5 rounded-md border p-2">
              <span className="font-medium">{vital.name}</span>
              <span className={cn("font-mono text-base", rating === "good" && "text-success", rating === "needs work" && "text-warning", rating === "poor" && "text-destructive")}>{value === undefined ? "—" : `${value}${vital.unit ? ` ${vital.unit}` : ""}`}</span>
              <span className="text-muted-foreground">{rating ? `${rating[0]!.toUpperCase()}${rating.slice(1)}. ` : ""}{vital.about}.</span>
            </li>
          );
        })}
      </ul>
      {vitals.lcpElement && <p className="text-muted-foreground">The largest thing drawn: {vitals.lcpElement}.</p>}
      {vitals.longTasks !== undefined && (
        <p className={cn(vitals.longTasks ? "text-warning" : "text-muted-foreground")}>
          {vitals.longTasks} long tasks blocked the page (over 50 ms), the longest {vitals.longestTask} ms.
        </p>
      )}
    </div>
  );
}

// ---- SEO ----
export function SeoPanel({ seo, onRefresh }: { seo: PageSeo | null; onRefresh: () => void }) {
  if (!seo) return empty("Open the page, and what it tells search engines and link previews shows here.");
  const findings = seoFindings(seo);
  return (
    <div className="grid content-start gap-2 overflow-auto p-2">
      <div className="flex items-center gap-2">
        <span className="font-medium">{findings.filter((finding) => finding.level === "problem").length} problems, {findings.filter((finding) => finding.level === "advice").length} pieces of advice</span>
        <Button size="icon-xs" variant="ghost" className="ml-auto" aria-label="Read the page's SEO again" title="Read again" onClick={onRefresh}>
          <RotateCw />
        </Button>
      </div>
      <ul aria-label="What was found" className="grid gap-1">
        {findings.map((finding, index) => (
          <li key={index} className={cn("rounded-md border-l-2 bg-muted/40 px-2 py-1", finding.level === "problem" && "border-destructive", finding.level === "advice" && "border-warning", finding.level === "good" && "border-success")}>
            <span className="sr-only">{finding.level === "problem" ? "Problem: " : finding.level === "advice" ? "Advice: " : "Good: "}</span>
            {finding.text}
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px]">
        {(
          [
            ["title", seo.title],
            ["description", seo.description],
            ["canonical", seo.canonical],
            ["robots", seo.robots],
            ["lang", seo.lang],
            ["viewport", seo.viewport],
            ...Object.entries(seo.openGraph),
            ...Object.entries(seo.twitter),
          ] as Array<[string, string | null]>
        ).map(([name, value]) => (
          <div key={name} className="contents">
            <dt className="text-muted-foreground">{name}</dt>
            <dd className="break-words">{value ?? "—"}</dd>
          </div>
        ))}
      </dl>
      {seo.headings.length > 0 && (
        <section aria-label="Headings" className="grid gap-0.5">
          <h4 className="font-medium">Headings</h4>
          <ol className="font-mono text-[11px]">
            {seo.headings.map((heading, index) => (
              <li key={index} style={{ paddingLeft: (heading.level - 1) * 12 }}>
                <span className="text-muted-foreground">h{heading.level}</span> {heading.text || "(empty)"}
              </li>
            ))}
          </ol>
        </section>
      )}
      {seo.images.withoutAlt.length > 0 && (
        <section aria-label="Images without alt text" className="grid gap-0.5">
          <h4 className="font-medium">Images without alt text</h4>
          <ul className="font-mono text-[11px]">
            {seo.images.withoutAlt.map((src, index) => (
              <li key={index} className="truncate">
                {pathOf(src)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ---- Application ----
const AREAS: Array<{ key: keyof PageStorage; name: string }> = [
  { key: "local", name: "Local storage" },
  { key: "session", name: "Session storage" },
  { key: "cookies", name: "Cookies" },
];
export function StoragePanel({ storage, onRefresh, onDelete, onClear }: { storage: PageStorage | null; onRefresh: () => void; onDelete: (area: keyof PageStorage, key: string) => void; onClear: (area: keyof PageStorage) => void }) {
  if (!storage) return empty("Open the page, and its local storage, session storage and cookies show here.");
  return (
    <div className="grid content-start gap-3 overflow-auto p-2">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Cookies the server set as httpOnly can&apos;t be seen from the page, so they aren&apos;t here.</span>
        <Button size="icon-xs" variant="ghost" className="ml-auto" aria-label="Read the storage again" title="Read again" onClick={onRefresh}>
          <RotateCw />
        </Button>
      </div>
      {AREAS.map((area) => (
        <section key={area.key} aria-label={area.name} className="grid gap-1">
          <div className="flex items-center gap-2">
            <h4 className="font-medium">
              {area.name} ({storage[area.key].length})
            </h4>
            {storage[area.key].length > 0 && (
              <Button size="xs" variant="ghost" onClick={() => onClear(area.key)}>
                Clear all
              </Button>
            )}
          </div>
          {storage[area.key].length === 0 ? (
            <p className="text-muted-foreground">Nothing.</p>
          ) : (
            <table className="w-full text-left font-mono text-[11px]">
              <tbody>
                {storage[area.key].map(([key, value]) => (
                  <tr key={key} className="border-b align-top">
                    <td className="w-1/3 max-w-0 truncate px-1 py-0.5 text-muted-foreground" title={key}>
                      {key}
                    </td>
                    <td className="max-w-0 truncate px-1 py-0.5" title={value}>
                      {value}
                    </td>
                    <td className="w-6">
                      <Button size="icon-xs" variant="ghost" aria-label={`Delete ${key}`} title="Delete" onClick={() => onDelete(area.key, key)}>
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  );
}
