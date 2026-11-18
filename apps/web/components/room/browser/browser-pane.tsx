/**
 * The room's own browser, beside the editor: a dev server in the sandbox (any port, any framework) shown in a frame, with an address bar, back, forward,
 * reload, a phone's or a tablet's width, and opening it in a tab of its own. Below it, DevTools: the Console (and running JavaScript in the page), the
 * Network, the Elements (and "click to code", which opens the code an element comes from: source-map.ts), Performance (Web Vitals), SEO, the page's
 * storage, and Lighthouse (devtools-panels.tsx, lighthouse-panel.tsx). The page tells the room all of this through the preview proxy's bridge
 * (apps/api/src/preview/preview-bridge.ts), and only from the frame's own origin.
 */
"use client";

import { textOf } from "@codechatter/workspace-model";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, ExternalLink, Loader2, MousePointerClick, PanelBottom, RotateCw, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { useRoomFiles } from "@/components/room/editor/room-files";
import { openPreview } from "@/components/room/open-preview";
import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

import { ConsolePanel, ElementsPanel, NetworkPanel, pathOf, PerformancePanel, SeoPanel, StoragePanel, type ConsoleEntry, type DomNode, type NetworkEntry, type PageStorage, type Vitals } from "./devtools-panels";
import { LighthousePanel } from "./lighthouse-panel";
import type { PageSeo } from "./seo";
import { codePlaceOf, type CodePlace, type InspectedElement } from "./source-map";

type Tool = "console" | "network" | "elements" | "performance" | "seo" | "application" | "lighthouse";
const WIDTHS: Array<[string, number | null]> = [
  ["Fit", null],
  ["Phone", 390],
  ["Tablet", 768],
  ["Laptop", 1280],
  ["Desktop", 1440],
];
const MOST_ROWS = 1000;
const TOOL_NAMES: Record<Tool, string> = { console: "Console", network: "Network", elements: "Elements", performance: "Performance", seo: "SEO", application: "Application", lighthouse: "Lighthouse" };

export function BrowserPane({ onClose, onOpenCode }: { onClose: () => void; onOpenCode: (place: CodePlace) => void }) {
  const { room, doc } = useRoom();
  const files = useRoomFiles();
  const frame = useRef<HTMLIFrameElement>(null);
  const [port, setPort] = useState<number | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const [address, setAddress] = useState("/");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [width, setWidth] = useState<number | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [tools, setTools] = useState(true);
  const [tool, setTool] = useState<Tool>("console");
  const [preserve, setPreserve] = useState(false);
  const [logs, setLogs] = useState<ConsoleEntry[]>([]);
  const [requests, setRequests] = useState<NetworkEntry[]>([]);
  const [element, setElement] = useState<{ info: InspectedElement; place: CodePlace | null } | null>(null);
  const [dom, setDom] = useState<{ root: DomNode; cut: boolean } | null>(null);
  const [vitals, setVitals] = useState<Vitals>({});
  const [seo, setSeo] = useState<PageSeo | null>(null);
  const [storage, setStorage] = useState<PageStorage | null>(null);
  const [filter, setFilter] = useState("");
  const counter = useRef(0);

  const status = useQuery({
    queryKey: ["sandbox", room.id],
    queryFn: () => api<{ ports: number[]; previews: boolean }>(`/api/rooms/${room.id}/sandbox`),
    refetchInterval: 4000,
  });
  const ports = status.data?.ports ?? [];
  const shownPort = port ?? ports[0] ?? null;

  /** Opens a path on the dev server: the first time through a one-time link, which gives this frame its own cookie; after that, straight there. */
  const go = async (path: string, fresh = false) => {
    if (shownPort === null) return;
    const wanted = path.startsWith("/") ? path : `/${path}`;
    setLoading(true);
    if (origin && !fresh && port === shownPort) {
      setSrc(`${origin}${wanted}`);
      return;
    }
    try {
      const { url } = await api<{ url: string }>(`/api/rooms/${room.id}/preview`, { method: "POST", json: { port: shownPort, path: wanted, frame: true } });
      setOrigin(new URL(url).origin);
      setPort(shownPort);
      setLogs([]);
      setRequests([]);
      setSrc(url);
    } catch (error) {
      setLoading(false);
      toast.error(error instanceof ApiError ? error.detail : "Couldn't open it.");
    }
  };
  const tell = (command: string, extra: Record<string, unknown> = {}) => {
    if (origin) frame.current?.contentWindow?.postMessage({ source: "codechatter-room", command, ...extra }, origin);
  };
  /** What the tab shown needs from the page, asked afresh. */
  const ask = (which: Tool) => {
    if (which === "elements") tell("dom");
    else if (which === "seo") tell("seo");
    else if (which === "application") tell("storage");
    else if (which === "performance") tell("vitals");
  };
  const choose = (which: Tool) => {
    setTool(which);
    ask(which);
  };
  const addLog = (level: string, text: string) => {
    counter.current += 1;
    const entry = { n: counter.current, level, text };
    setLogs((all) => [...all.slice(-(MOST_ROWS - 1)), entry]);
  };

  // What the page says, from the frame's own origin only.
  const latest = useRef({ inspecting, files, preserve, tool });
  useEffect(() => {
    latest.current = { inspecting, files, preserve, tool };
  });
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; type?: string } & Record<string, unknown>;
      if (!origin || event.origin !== origin || event.source !== frame.current?.contentWindow || data?.source !== "codechatter-preview") return;
      const command = (name: string, extra: Record<string, unknown> = {}) => frame.current?.contentWindow?.postMessage({ source: "codechatter-room", command: name, ...extra }, origin);
      if (data.type === "location") {
        setAddress(pathOf(String(data.href ?? "")));
        setTitle(String(data.title ?? ""));
        setLoading(false);
      } else if (data.type === "ready") {
        // A new page: unless the log is kept, it starts afresh, as in DevTools; click to code carries on in it; the tab shown is read again.
        if (!latest.current.preserve) {
          setLogs([]);
          setRequests((all) => all.filter((entry) => entry.initiator === "document").slice(-1));
        }
        setVitals({});
        if (latest.current.inspecting) command("inspect", { on: true });
        const shown = latest.current.tool;
        if (shown === "elements") command("dom");
        else if (shown === "seo") command("seo");
        else if (shown === "application") command("storage");
      } else if (data.type === "console") {
        counter.current += 1;
        const entry = { n: counter.current, level: String(data.level ?? "log"), text: String(data.text ?? "") };
        setLogs((all) => [...all.slice(-(MOST_ROWS - 1)), entry]);
      } else if (data.type === "evaluated") {
        counter.current += 1;
        const entry = { n: counter.current, level: data.ok ? "result" : "error", text: String(data.text ?? "") };
        setLogs((all) => [...all.slice(-(MOST_ROWS - 1)), entry]);
      } else if (data.type === "request") {
        const entry: NetworkEntry = { key: `r${String(data.id)}`, method: String(data.method ?? "GET"), url: String(data.url ?? ""), initiator: String(data.initiator ?? ""), status: null, failed: false, size: null, durationMs: null };
        setRequests((all) => [...all.slice(-(MOST_ROWS - 1)), entry]);
      } else if (data.type === "response") {
        setRequests((all) => all.map((entry) => (entry.key === `r${String(data.id)}` ? { ...entry, status: typeof data.status === "number" ? data.status : null, failed: Boolean(data.failed) || data.ok === false, size: typeof data.size === "number" ? data.size : null, durationMs: typeof data.durationMs === "number" ? data.durationMs : null, contentType: String(data.contentType ?? "") } : entry)));
      } else if (data.type === "resource") {
        counter.current += 1;
        const entry: NetworkEntry = { key: `s${counter.current}`, method: "GET", url: String(data.url ?? ""), initiator: String(data.initiator ?? ""), status: typeof data.status === "number" ? data.status : null, failed: Boolean(data.failed) || (typeof data.status === "number" && data.status >= 400), size: typeof data.size === "number" ? data.size : null, durationMs: typeof data.durationMs === "number" ? data.durationMs : null };
        setRequests((all) => [...all.slice(-(MOST_ROWS - 1)), entry]);
      } else if (data.type === "vitals") {
        setVitals((data.vitals as Vitals) ?? {});
      } else if (data.type === "seo") {
        setSeo(data.seo as PageSeo);
      } else if (data.type === "storage") {
        setStorage(data.storage as PageStorage);
      } else if (data.type === "dom") {
        setDom(data.dom as { root: DomNode; cut: boolean });
      } else if (data.type === "inspect") {
        setInspecting(Boolean(data.on));
      } else if (data.type === "inspected") {
        const info = data.element as InspectedElement;
        // The room's files with their text, for an element its page says nothing about.
        const known = latest.current.files.filter((file) => !file.blob).map((file) => ({ id: file.id, path: file.path, text: textOf(doc, file.id)?.toString() ?? "" }));
        const place = codePlaceOf(info, known);
        setElement({ info, place });
        setTools(true);
        if (data.from === "tree") return;
        // Picked in the page itself: straight to its code.
        setTool("elements");
        command("dom");
        if (place) onOpenCode(place);
        else toast.message("Its code wasn't found in the room's files.");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin, doc, onOpenCode]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void go(address || "/");
  };
  const errors = logs.filter((entry) => entry.level === "error").length;
  const failures = requests.filter((entry) => entry.failed).length;
  const tabs: Array<[Tool, string]> = [
    ["console", `Console${errors ? ` (${errors} ${errors === 1 ? "error" : "errors"})` : ""}`],
    ["network", `Network${requests.length ? ` (${requests.length}${failures ? `, ${failures} failed` : ""})` : ""}`],
    ["elements", "Elements"],
    ["performance", "Performance"],
    ["seo", "SEO"],
    ["application", "Application"],
    ["lighthouse", "Lighthouse"],
  ];

  return (
    <section aria-label="Browser" className="flex h-full min-h-0 flex-col bg-background text-xs">
      <form onSubmit={submit} className="flex h-9 shrink-0 items-center gap-1 border-b bg-chrome px-2">
        <Button type="button" size="icon-xs" variant="ghost" aria-label="Back" title="Back" disabled={!src} onClick={() => tell("back")}>
          <ArrowLeft />
        </Button>
        <Button type="button" size="icon-xs" variant="ghost" aria-label="Forward" title="Forward" disabled={!src} onClick={() => tell("forward")}>
          <ArrowRight />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Reload"
          title="Reload"
          disabled={!src}
          onClick={() => {
            setLoading(true);
            tell("reload");
          }}
        >
          {loading ? <Loader2 className="animate-spin" /> : <RotateCw />}
        </Button>
        <select
          aria-label="Server"
          className="h-6 rounded-md border bg-background px-1 text-xs"
          value={shownPort ?? ""}
          onChange={(event) => {
            setPort(Number(event.target.value));
            setOrigin(null);
            setSrc(null);
          }}
        >
          {ports.length === 0 && <option value="">No server running</option>}
          {ports.map((each) => (
            <option key={each} value={each}>
              :{each}
            </option>
          ))}
        </select>
        <input aria-label="Address" className="h-6 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" value={address} spellCheck={false} onChange={(event) => setAddress(event.target.value)} placeholder="/" />
        <Button type="submit" size="xs" variant="outline" disabled={shownPort === null}>
          {src ? "Go" : "Open"}
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant={inspecting ? "secondary" : "ghost"}
          aria-label="Click to code"
          aria-pressed={inspecting}
          title="Click to code: click anything in the page to open its code"
          disabled={!src}
          onClick={() => {
            const next = !inspecting;
            setInspecting(next);
            tell("inspect", { on: next });
          }}
        >
          <MousePointerClick />
        </Button>
        <select aria-label="Width" className="h-6 rounded-md border bg-background px-1 text-xs" value={width ?? ""} onChange={(event) => setWidth(event.target.value ? Number(event.target.value) : null)}>
          {WIDTHS.map(([label, value]) => (
            <option key={label} value={value ?? ""}>
              {label}
            </option>
          ))}
        </select>
        <Button type="button" size="icon-xs" variant={tools ? "secondary" : "ghost"} aria-label="DevTools" aria-pressed={tools} title="Console, Network, Elements, Performance, SEO, Application and Lighthouse" onClick={() => setTools(!tools)}>
          <PanelBottom />
        </Button>
        <Button type="button" size="icon-xs" variant="ghost" aria-label="Open in a new tab" title="Open in a new tab" disabled={shownPort === null} onClick={() => shownPort !== null && void openPreview(room.id, shownPort, address)}>
          <ExternalLink />
        </Button>
        <Button type="button" size="icon-xs" variant="ghost" aria-label="Close the browser" title="Close" onClick={onClose}>
          <X />
        </Button>
      </form>

      <div className={cn("min-h-0 overflow-auto bg-muted/40", tools ? "flex-[3]" : "flex-1")}>
        {src ? (
          <div className="mx-auto h-full bg-background" style={width ? { width, maxWidth: "none" } : undefined}>
            <iframe
              ref={frame}
              key={src}
              title={title ? `The page: ${title}` : "The page"}
              src={src}
              className="h-full w-full border-0"
              // The page is someone's own code, on its own origin: it can do what a page does, and nothing in the room.
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
              onLoad={() => setLoading(false)}
            />
          </div>
        ) : (
          <div className="grid h-full place-content-center gap-2 p-6 text-center text-muted-foreground">
            {status.data && !status.data.previews ? (
              <p>Live previews are turned off on this server.</p>
            ) : ports.length === 0 ? (
              <p>Start a dev server (Run, or the Dev server tab), and its page shows here.</p>
            ) : (
              <>
                <p>A server is running on :{shownPort}.</p>
                <div>
                  <Button size="xs" onClick={() => void go(address || "/", true)}>
                    Open it here
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {tools && (
        <div className="flex min-h-0 flex-[2] flex-col border-t">
          <div className="flex h-8 shrink-0 items-center gap-1 border-b px-2">
            <div role="tablist" aria-label="DevTools" className="flex min-w-0 items-center gap-3 overflow-x-auto [scrollbar-width:none]">
              {tabs.map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={tool === id} onClick={() => choose(id)} className={cn("relative h-8 shrink-0 font-medium whitespace-nowrap", tool === id ? "text-foreground" : "text-muted-foreground hover:text-foreground", id === "console" && errors && "text-destructive")}>
                  {label}
                  {tool === id && <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] bg-brand" />}
                </button>
              ))}
            </div>
            {(tool === "console" || tool === "network") && (
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <label className="flex items-center gap-1 text-muted-foreground" title="Keep what was logged when the page changes">
                  <input type="checkbox" checked={preserve} onChange={(event) => setPreserve(event.target.checked)} />
                  Preserve log
                </label>
                <input aria-label="Filter" placeholder="Filter" className="h-6 w-24 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" value={filter} onChange={(event) => setFilter(event.target.value)} />
                <Button size="icon-xs" variant="ghost" aria-label={tool === "console" ? "Clear the console" : "Clear the network"} title="Clear" onClick={() => (tool === "console" ? setLogs([]) : setRequests([]))}>
                  <Trash2 />
                </Button>
              </div>
            )}
          </div>
          <div role="tabpanel" aria-label={TOOL_NAMES[tool]} className="min-h-0 flex-1 overflow-hidden">
            {tool === "console" && (
              <ConsolePanel
                entries={filter.trim() ? logs.filter((entry) => entry.text.toLowerCase().includes(filter.trim().toLowerCase())) : logs}
                onRun={(code) => {
                  if (!origin) return toast.message("Open a page first.");
                  addLog("input", code);
                  tell("eval", { id: Date.now(), code });
                }}
              />
            )}
            {tool === "network" && <NetworkPanel entries={requests} filter={filter} />}
            {tool === "elements" && (
              <ElementsPanel
                dom={dom?.root ?? null}
                cut={dom?.cut ?? false}
                element={element}
                onRefresh={() => tell("dom")}
                onHover={(path) => tell("dom-hover", { path })}
                onLeave={() => tell("dom-leave")}
                onSelect={(path) => tell("dom-select", { path })}
                onOpenCode={onOpenCode}
              />
            )}
            {tool === "performance" && <PerformancePanel vitals={vitals} />}
            {tool === "seo" && <SeoPanel seo={seo} onRefresh={() => tell("seo")} />}
            {tool === "application" && <StoragePanel storage={storage} onRefresh={() => tell("storage")} onDelete={(area, key) => tell("storage-delete", { area, key })} onClear={(area) => tell("storage-clear", { area })} />}
            {tool === "lighthouse" && <LighthousePanel port={src ? port : null} path={address} />}
          </div>
        </div>
      )}
    </section>
  );
}
