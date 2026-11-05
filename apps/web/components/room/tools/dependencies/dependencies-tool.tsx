/** Check live room manifests against OSV and keep each alert linked to its source line. */
"use client";

import { parseManifests, type DependencyCheckResponse, type DependencyPackage, type DependencyResult, type DependencySeverity, type ParsedDependency } from "@codechatter/contracts";
import { useQuery } from "@tanstack/react-query";
import { Copy, RefreshCw, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import type * as Y from "yjs";

import { openRoomFile } from "@/components/room/editor/editor-opener";
import { useRoom } from "@/components/room/room-context";
import { roomTexts } from "@/components/room/source-control/room-files";
import type { RoomToolProps } from "@/components/room/tools/registry";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

const SEVERITIES: DependencySeverity[] = ["critical", "high", "moderate", "low", "unknown"];
const LABELS: Record<DependencySeverity, string> = { critical: "Critical", high: "High", moderate: "Moderate", low: "Low", unknown: "Unknown severity" };
const EMPTY = "No dependency files found (package.json, requirements.txt, go.mod, Cargo.lock, composer.lock, pom.xml).";
const keyOf = (pkg: DependencyPackage) => JSON.stringify([pkg.ecosystem, pkg.name, pkg.version]);
const manifestName = /^(?:package(?:-lock)?\.json|pnpm-lock\.yaml|requirements[^/]*\.txt|poetry\.lock|go\.mod|Cargo\.lock|composer\.lock|pom\.xml)$/;

function manifestFiles(doc: Y.Doc) {
  return [...roomTexts(doc)].filter(([path]) => {
    const parts = path.replaceAll("\\", "/").split("/");
    return !parts.some((part) => ["node_modules", "vendor", ".venv", "target"].includes(part)) && manifestName.test(parts.at(-1) ?? "");
  }).sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => ({ path, content }));
}

/** Snapshot identity changes only when manifests change, including remote Yjs edits. */
function manifestStore(doc: Y.Doc) {
  let current = manifestFiles(doc);
  return {
    getSnapshot: () => current,
    subscribe: (notify: () => void) => {
      const refresh = () => {
        const next = manifestFiles(doc);
        if (next.length === current.length && next.every((file, i) => file.path === current[i]?.path && file.content === current[i]?.content)) return;
        current = next;
        notify();
      };
      doc.on("update", refresh);
      refresh();
      return () => doc.off("update", refresh);
    },
  };
}

function severityOf(pkg: DependencyResult): DependencySeverity {
  return SEVERITIES.find((severity) => pkg.vulns.some((vuln) => vuln.severity === severity)) ?? "unknown";
}

function summaryOf(data: DependencyCheckResponse): string {
  const affected = data.results.filter((pkg) => pkg.vulns.length);
  const total = `${data.results.length} ${data.results.length === 1 ? "package" : "packages"}`;
  if (!data.results.length) return "No packages with a version to check.";
  if (!affected.length) return `No known vulnerabilities in ${total}.`;
  const counts = SEVERITIES.map((severity) => {
    const count = affected.filter((pkg) => severityOf(pkg) === severity).length;
    return count ? `${count} ${severity === "unknown" ? "unknown severity" : severity}` : null;
  }).filter(Boolean).join(", ");
  return `${total}, ${affected.length} with known vulnerabilities (${counts}).`;
}

const markdown = (text: string) => text.replace(/[\r\n]+/g, " ").replace(/[\\`*_{}[\]()<>|]/g, "\\$&");
function reportOf(data: DependencyCheckResponse, locations: Map<string, ParsedDependency>): string {
  const out = ["# Dependency alerts", "", summaryOf(data), ""];
  const sorted = [...data.results].sort((a, b) => Number(!a.vulns.length) - Number(!b.vulns.length) || SEVERITIES.indexOf(severityOf(a)) - SEVERITIES.indexOf(severityOf(b)) || a.name.localeCompare(b.name));
  for (const pkg of sorted) {
    const location = locations.get(keyOf(pkg));
    out.push(`## ${markdown(pkg.name)} ${markdown(pkg.version)} (${pkg.ecosystem})`);
    if (location) out.push(`Source: ${markdown(location.path)}:${location.line}`);
    if (!pkg.vulns.length) out.push("No known vulnerabilities.");
    for (const vuln of pkg.vulns) out.push(`- **${vuln.severity}** [${markdown(vuln.id)}](https://osv.dev/vulnerability/${encodeURIComponent(vuln.id)}): ${markdown(vuln.summary)}. ${vuln.fixed ? `Fixed in ${markdown(vuln.fixed)}.` : "Fixed version not listed."}`);
    out.push("");
  }
  if (data.unchecked.length) {
    out.push("## Not checked (no exact version)", "");
    for (const pkg of data.unchecked) {
      const location = locations.get(keyOf(pkg));
      out.push(`- ${markdown(pkg.name)} (${pkg.ecosystem})${location ? `, ${markdown(location.path)}:${location.line}` : ""}`);
    }
  }
  return out.join("\n");
}

function Source({ value }: { value: ParsedDependency | undefined }) {
  if (!value) return <span className="text-muted-foreground">Location unavailable</span>;
  // Long paths wrap after a slash, never in the middle of a name.
  const parts = value.path.split("/");
  return <Button size="xs" variant="link" className="h-auto min-h-6 max-w-full justify-start p-0 text-left font-mono text-xs whitespace-normal break-words" aria-label={`Open ${value.path}:${value.line}`} onClick={() => {
    if (!openRoomFile(value.path, { startLine: value.line, startColumn: 1, endLine: value.line, endColumn: 1 })) toast.error("That file is no longer available.");
  }}>{parts.map((part, index) => <Fragment key={index}>{index > 0 && <>/<wbr /></>}{part}</Fragment>)}:{value.line}</Button>;
}

function PackageRow({ pkg, location }: { pkg: DependencyResult; location: ParsedDependency | undefined }) {
  return <article aria-label={`${pkg.name} ${pkg.version}`} className="grid min-w-0 gap-2 border-b px-3 py-3 last:border-b-0">
    <div className="grid min-w-0 gap-1"><h4 className="break-all font-mono font-medium">{pkg.name} <span className="font-normal text-muted-foreground">{pkg.version}</span></h4><span className="text-muted-foreground">{pkg.ecosystem}</span><Source value={location} /></div>
    {pkg.vulns.map((vuln) => <div key={vuln.id} className="grid min-w-0 gap-1 border-l-2 pl-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className={cn("text-xs font-medium", ["critical", "high"].includes(vuln.severity) ? "text-destructive" : "text-muted-foreground")}>{LABELS[vuln.severity]}</span><a href={`https://osv.dev/vulnerability/${encodeURIComponent(vuln.id)}`} target="_blank" rel="noopener noreferrer" className="break-all font-mono underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{vuln.id}</a></div>
      <p className="break-words">{vuln.summary}</p>
      <p className="break-words text-muted-foreground">{vuln.fixed ? `Fixed in ${vuln.fixed}` : "Fixed version not listed"}</p>
    </div>)}
  </article>;
}

function DependenciesPanel({ roomId, doc, close }: { roomId: string; doc: Y.Doc; close: () => void }) {
  const store = useMemo(() => manifestStore(doc), [doc]);
  const files = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const packages = useMemo(() => parseManifests(files), [files]);
  const locations = useMemo(() => new Map(packages.map((pkg) => [keyOf(pkg), pkg])), [packages]);
  const input = useMemo(() => ({ packages: packages.map(({ ecosystem, name, version }) => ({ ecosystem, name, version })) }), [packages]);
  const tooMany = packages.length > 5000;
  const first = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const query = useQuery({
    queryKey: ["room-dependencies", roomId, input], enabled: false, retry: false, staleTime: 6 * 60 * 60_000,
    queryFn: ({ signal }) => api<DependencyCheckResponse>(`/api/rooms/${roomId}/dependencies/check`, { method: "POST", json: input, signal }),
  });
  const refetch = query.refetch;
  useEffect(() => {
    if (!packages.length || tooMany) return;
    timer.current = setTimeout(() => { first.current = false; void refetch(); }, first.current ? 0 : 10_000);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [files, packages.length, tooMany, refetch]);
  const data = query.data;
  const affected = data?.results.filter((pkg) => pkg.vulns.length) ?? [];
  const clean = data?.results.filter((pkg) => !pkg.vulns.length) ?? [];
  return <section aria-label="Dependencies" aria-busy={query.isFetching} className="flex h-full min-h-0 min-w-0 flex-col bg-panel text-xs">
    <div className="flex h-9 shrink-0 items-center gap-1 border-b px-3"><h2 className="mr-auto min-w-0 truncate font-medium">Dependencies</h2><Button size="icon-xs" variant="ghost" className="shrink-0" aria-label="Close dependencies" onClick={close}><X /></Button></div>
    <div className="flex shrink-0 flex-wrap gap-2 border-b p-3"><Button size="xs" className="h-auto min-h-6 min-w-0 max-w-full whitespace-normal" disabled={!packages.length || tooMany || query.isFetching} onClick={() => { if (timer.current) clearTimeout(timer.current); first.current = false; void refetch(); }}><RefreshCw className={cn(query.isFetching && "animate-spin motion-reduce:animate-none")} />{query.isFetching ? "Checking..." : "Check"}</Button><Button size="xs" variant="outline" className="h-auto min-h-6 min-w-0 max-w-full whitespace-normal" disabled={!data || !packages.length || tooMany} onClick={async () => { if (data && await copyText(reportOf(data, locations))) toast.success("Dependency report copied"); else toast.error("Couldn't copy the report. Try again."); }}><Copy />Copy as Markdown</Button></div>
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      {!files.length ? <p className="p-3 text-muted-foreground">{EMPTY}</p> : !packages.length ? <p className="p-3 text-muted-foreground">No packages found in the dependency files. Check their format.</p> : tooMany ? <p role="alert" className="p-3">This room has {packages.length} dependencies. A check supports up to 5,000 packages.</p> : <>
        {query.isError && <p role="alert" className="border-b p-3 text-destructive">{query.error instanceof ApiError ? query.error.detail : "Couldn't check dependencies. Try again."}</p>}
        <div aria-live="polite" className="grid grid-cols-1 gap-2 border-b p-3 break-words"><p className="font-medium">{data ? summaryOf(data) : query.isFetching ? "Checking the vulnerability database..." : "A dependency check will start shortly."}</p>{data && <p className="text-muted-foreground">Results from {new Date(query.dataUpdatedAt).toLocaleTimeString()}.</p>}<p className="text-muted-foreground">Lock files give exact versions. Simple manifest ranges use their lowest stated version; installed versions may differ.</p></div>
        {SEVERITIES.map((severity) => {
          const items = affected.filter((pkg) => severityOf(pkg) === severity).sort((a, b) => a.name.localeCompare(b.name));
          return items.length ? <section key={severity} aria-label={`${LABELS[severity]} packages`}><h3 className="border-b bg-muted/30 px-3 py-2 font-medium">{LABELS[severity]} ({items.length})</h3>{items.map((pkg) => <PackageRow key={keyOf(pkg)} pkg={pkg} location={locations.get(keyOf(pkg))} />)}</section> : null;
        })}
        {clean.length > 0 && <details className="border-b"><summary className="cursor-pointer px-3 py-2 font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">No known vulnerabilities ({clean.length})</summary>{clean.sort((a, b) => a.name.localeCompare(b.name)).map((pkg) => <PackageRow key={keyOf(pkg)} pkg={pkg} location={locations.get(keyOf(pkg))} />)}</details>}
        {data && data.unchecked.length > 0 && <details className="border-b"><summary className="cursor-pointer px-3 py-2 font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">Not checked (no exact version) ({data.unchecked.length})</summary><ul className="grid gap-3 p-3">{data.unchecked.map((pkg) => <li key={keyOf(pkg)} className="grid min-w-0 gap-1"><span className="break-all font-mono">{pkg.name} <span className="text-muted-foreground">({pkg.ecosystem})</span></span><Source value={locations.get(keyOf(pkg))} /></li>)}</ul></details>}
      </>}
    </div>
  </section>;
}

export default function DependenciesTool({ close }: RoomToolProps) {
  const { room, doc } = useRoom();
  return <DependenciesPanel key={room.id} roomId={room.id} doc={doc} close={close} />;
}
