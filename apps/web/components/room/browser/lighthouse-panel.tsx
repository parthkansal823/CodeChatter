/**
 * Lighthouse in the room's browser: Google's own, run in the room's sandbox against the server and page shown (apps/runner/src/lighthouse.ts), as a phone
 * (throttled, as Lighthouse does) or a desktop. Each category's score, the Core Web Vitals, what failed with Lighthouse's advice, and its whole report.
 */
"use client";

import { LIGHTHOUSE_CATEGORIES, type LighthouseReport } from "@codechatter/contracts";
import { ExternalLink, Gauge, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

const NAMES: Record<(typeof LIGHTHOUSE_CATEGORIES)[number], string> = { performance: "Performance", accessibility: "Accessibility", "best-practices": "Best practices", seo: "SEO" };
/**
 * Lighthouse's own report, whole: HTML made in the room's sandbox, so it runs in the HTML preview's sandboxed page (app/frames/document), with an origin
 * of its own and its own policy, never the app's.
 */
function ReportFrame({ html }: { html: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !(event.data as { __ccFrameReady?: boolean })?.__ccFrameReady) return;
      frame.current?.contentWindow?.postMessage({ __ccDocument: true, html }, "*");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [html]);
  return <iframe ref={frame} title="Lighthouse's full report" src="/frames/document" sandbox="allow-scripts allow-popups" className="h-full w-full rounded-md border bg-background" />;
}

const rating = (score: number | null) => (score === null ? "" : score >= 90 ? "text-success border-success" : score >= 50 ? "text-warning border-warning" : "text-destructive border-destructive");

export function LighthousePanel({ port, path }: { port: number | null; path: string }) {
  const { room, can } = useRoom();
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const [categories, setCategories] = useState<string[]>([...LIGHTHOUSE_CATEGORIES]);
  const [running, setRunning] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [report, setReport] = useState<LighthouseReport | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [full, setFull] = useState(false);

  // How long it's been going: a run takes half a minute or so.
  useEffect(() => {
    if (running === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const run = async () => {
    if (port === null) return;
    const started = Date.now();
    setRunning(started);
    setNow(started);
    setProblem(null);
    try {
      setReport(await api<LighthouseReport>(`/api/rooms/${room.id}/lighthouse`, { method: "POST", json: { port, path: path.split("#")[0] || "/", device, categories } }));
    } catch (error) {
      setProblem(error instanceof ApiError ? error.detail : "Lighthouse couldn't run. Try again.");
    } finally {
      setRunning(null);
    }
  };

  if (!can("code.run")) return <p className="p-2 text-muted-foreground">Lighthouse runs a browser in the room&apos;s sandbox, so it needs Run rights.</p>;
  return (
    <div className="grid content-start gap-3 overflow-auto p-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">
          As a
          <select aria-label="Device" className="h-6 rounded-md border bg-background px-1 text-xs" value={device} disabled={running !== null} onChange={(event) => setDevice(event.target.value as "mobile" | "desktop")}>
            <option value="mobile">phone (throttled)</option>
            <option value="desktop">desktop</option>
          </select>
        </label>
        <div role="group" aria-label="Categories" className="flex flex-wrap items-center gap-2">
          {LIGHTHOUSE_CATEGORIES.map((category) => (
            <label key={category} className="flex items-center gap-1">
              <input
                type="checkbox"
                disabled={running !== null}
                checked={categories.includes(category)}
                onChange={(event) => setCategories((all) => (event.target.checked ? [...all, category] : all.filter((each) => each !== category)))}
              />
              {NAMES[category]}
            </label>
          ))}
        </div>
        <Button size="xs" className="ml-auto" disabled={running !== null || port === null || categories.length === 0} onClick={() => void run()}>
          {running !== null ? <Loader2 className="animate-spin" /> : <Gauge />} {report ? "Run again" : "Run Lighthouse"}
        </Button>
      </div>
      {port === null && <p className="text-muted-foreground">Open a server&apos;s page first: Lighthouse runs on the page shown.</p>}
      {running !== null && (
        <p role="status" className="text-muted-foreground">
          Running Lighthouse on {path || "/"}, as a {device === "mobile" ? "phone" : "desktop"}: {Math.round((now - running) / 1000)} s (about half a minute).
        </p>
      )}
      {problem && (
        <p role="alert" className="text-destructive">
          {problem}
        </p>
      )}
      {report && running === null && (
        <section aria-label="Lighthouse's report" className="grid gap-3">
          <ul aria-label="Scores" className="flex flex-wrap gap-3">
            {report.categories.map((category) => (
              <li key={category.id} className="grid justify-items-center gap-1">
                <span className={cn("flex size-12 items-center justify-center rounded-full border-4 font-mono text-sm font-semibold", rating(category.score))}>{category.score ?? "?"}</span>
                <span>{category.title}</span>
              </li>
            ))}
          </ul>
          {report.metrics.length > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              {report.metrics.map((metric) => (
                <div key={metric.id} className="contents">
                  <dt className="text-muted-foreground">{metric.title}</dt>
                  <dd className={cn("font-mono", metric.score === null ? "" : metric.score >= 0.9 ? "text-success" : metric.score >= 0.5 ? "text-warning" : "text-destructive")}>{metric.displayValue ?? "—"}</dd>
                </div>
              ))}
            </dl>
          )}
          {report.categories.map((category) =>
            category.failing.length === 0 ? null : (
              <section key={category.id} aria-label={`${category.title}: what to fix`} className="grid gap-1">
                <h4 className="font-medium">
                  {category.title}: {category.failing.length} to fix
                </h4>
                <ul className="grid gap-1">
                  {category.failing.map((audit) => (
                    <li key={audit.id}>
                      <details className="rounded-md border px-2 py-1">
                        <summary className="cursor-pointer">
                          <span className={cn("mr-1 inline-block size-2 rounded-full", audit.score !== null && audit.score >= 0.5 ? "bg-warning" : "bg-destructive")} aria-hidden />
                          {audit.title}
                          {audit.displayValue ? <span className="text-muted-foreground"> · {audit.displayValue}</span> : null}
                        </summary>
                        <p className="mt-1 text-muted-foreground">{audit.description}</p>
                      </details>
                    </li>
                  ))}
                </ul>
              </section>
            ),
          )}
          {report.warnings.length > 0 && (
            <ul aria-label="Lighthouse's warnings" className="grid gap-1 text-warning">
              {report.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
            <span>
              Lighthouse {report.lighthouseVersion}, {new Date(report.fetchedAt).toLocaleString()}, on {report.url}
            </span>
            {report.html && (
              <Button size="xs" variant="outline" onClick={() => setFull(true)}>
                <ExternalLink /> The full report
              </Button>
            )}
          </div>
          {report.html && (
            <Dialog open={full} onOpenChange={setFull}>
              <DialogContent className="flex h-[88vh] max-w-[min(72rem,95vw)] flex-col gap-2 sm:max-w-[min(72rem,95vw)]">
                <DialogHeader>
                  <DialogTitle>Lighthouse&apos;s report</DialogTitle>
                  <DialogDescription>
                    {report.url}, as a {report.device === "mobile" ? "phone" : "desktop"}.
                  </DialogDescription>
                </DialogHeader>
                <div className="min-h-0 flex-1">{full && <ReportFrame html={report.html} />}</div>
              </DialogContent>
            </Dialog>
          )}
        </section>
      )}
    </div>
  );
}
