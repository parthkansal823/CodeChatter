"use client";

import { Check, Loader2, Minus, Play, Square, X } from "lucide-react";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { formatMs, methodLabel, statusTone } from "./format";
import { findItem, requestsIn, type TreeItem } from "./model";
import { useStudio } from "./studio-context";

type Outcome = "pending" | "running" | "passed" | "failed" | "skipped";
type Row = { item: TreeItem; outcome: Outcome; status: number | null; timeMs: number | null; passed: number; total: number; note: string };

export function RunDialog() {
  const { dialog, openDialog, tree } = useStudio();
  const open = dialog?.kind === "run";
  const folderId = dialog?.kind === "run" ? dialog.folderId : null;
  const folder = folderId ? findItem(tree, folderId) : null;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && openDialog(null)}>
      <DialogContent className="grid max-h-[85vh] grid-rows-[auto_minmax(0,1fr)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Run {folder ? folder.name : "all requests"}</DialogTitle>
          <DialogDescription>Sends each request in order, one after another. Variables set by one request are there for the next.</DialogDescription>
        </DialogHeader>
        {open && <RunBody key={folderId ?? "all"} items={requestsIn(folder ? folder.children : tree)} />}
      </DialogContent>
    </Dialog>
  );
}

function RunBody({ items }: { items: TreeItem[] }) {
  const { send, canSend, env } = useStudio();
  const [rows, setRows] = useState<Row[]>(() => items.map((item) => ({ item, outcome: "pending", status: null, timeMs: null, passed: 0, total: 0, note: "" })));
  const [running, setRunning] = useState(false);
  const [stopOnFail, setStopOnFail] = useState(false);
  const halt = useRef(false);
  const uid = useId();

  const update = (index: number, patch: Partial<Row>) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const run = async () => {
    halt.current = false;
    setRunning(true);
    setRows(items.map((item) => ({ item, outcome: "pending", status: null, timeMs: null, passed: 0, total: 0, note: "" })));
    for (let i = 0; i < items.length; i++) {
      if (halt.current) {
        setRows((current) => current.map((row, at) => (at >= i ? { ...row, outcome: "skipped" } : row)));
        break;
      }
      update(i, { outcome: "running" });
      const state = await send(items[i]!.id);
      if (!state) {
        update(i, { outcome: "skipped", note: "Already sending" });
        continue;
      }
      const result = state.result;
      const passed = state.checks.filter((c) => c.passed).length;
      const response = result?.ok ? result : null;
      // A response that arrived with every test passing is a pass; with no tests, an error status is a failure.
      const ok = response !== null && passed === state.checks.length && (state.checks.length > 0 || response.status < 400);
      update(i, {
        outcome: ok ? "passed" : "failed",
        status: response?.status ?? null,
        timeMs: result?.timing.totalMs ?? null,
        passed,
        total: state.checks.length,
        note: state.problem ?? (result && !result.ok ? result.message : ""),
      });
      if (!ok && stopOnFail) {
        setRows((current) => current.map((row, at) => (at > i ? { ...row, outcome: "skipped" } : row)));
        break;
      }
    }
    setRunning(false);
  };

  const done = rows.filter((r) => r.outcome === "passed" || r.outcome === "failed");
  const failed = rows.filter((r) => r.outcome === "failed").length;
  const total = done.reduce((sum, r) => sum + (r.timeMs ?? 0), 0);

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {running ? (
          <Button size="sm" variant="secondary" onClick={() => (halt.current = true)}>
            <Square /> Stop
          </Button>
        ) : (
          <span title={canSend ? undefined : "You need run access to send requests."}>
            <Button size="sm" variant="brand" disabled={!canSend || items.length === 0} onClick={run}>
              <Play /> {done.length ? "Run again" : "Run"}
            </Button>
          </span>
        )}
        <div className="flex items-center gap-2">
          <Checkbox id={`${uid}-stop`} checked={stopOnFail} disabled={running} onCheckedChange={(checked) => setStopOnFail(checked === true)} />
          <Label htmlFor={`${uid}-stop`} className="text-sm font-normal">
            Stop at the first failure
          </Label>
        </div>
        <span className="ml-auto text-xs text-muted-foreground">Environment: {env ? env.name : "none"}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">There are no requests to run here.</p>
      ) : (
        <div className="min-h-0 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Request</TableHead>
                <TableHead className="w-16">Status</TableHead>
                <TableHead className="w-20">Time</TableHead>
                <TableHead className="w-16">Tests</TableHead>
                <TableHead className="w-24">Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={row.item.id}>
                  <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                  <TableCell className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="w-8 shrink-0 text-right font-mono text-2xs font-semibold text-muted-foreground">{methodLabel(row.item.method)}</span>
                      <span className="truncate">{row.item.name}</span>
                    </span>
                    {row.note && <span className="block pl-10 text-xs text-muted-foreground">{row.note}</span>}
                  </TableCell>
                  <TableCell className={cn("tabular-nums", row.status !== null && statusTone(row.status))}>{row.status ?? ""}</TableCell>
                  <TableCell className="tabular-nums">{row.timeMs !== null ? formatMs(row.timeMs) : ""}</TableCell>
                  <TableCell className="tabular-nums">{row.total > 0 ? `${row.passed}/${row.total}` : row.outcome === "passed" || row.outcome === "failed" ? "none" : ""}</TableCell>
                  <TableCell>
                    <Result outcome={row.outcome} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {done.length > 0 && (
        <p role="status" className="text-sm">
          {done.length} of {rows.length} sent in {formatMs(total)}.{" "}
          <span className={failed ? "text-destructive" : "text-success"}>{failed ? `${failed} failed.` : "All passed."}</span>
        </p>
      )}
    </div>
  );
}

function Result({ outcome }: { outcome: Outcome }) {
  switch (outcome) {
    case "running":
      return (
        <span className="flex items-center gap-1 text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Sending
        </span>
      );
    case "passed":
      return (
        <span className="flex items-center gap-1 text-success">
          <Check className="size-3.5" aria-hidden /> Passed
        </span>
      );
    case "failed":
      return (
        <span className="flex items-center gap-1 text-destructive">
          <X className="size-3.5" aria-hidden /> Failed
        </span>
      );
    case "skipped":
      return (
        <span className="flex items-center gap-1 text-muted-foreground">
          <Minus className="size-3.5" aria-hidden /> Skipped
        </span>
      );
    default:
      return <span className="text-muted-foreground">Waiting</span>;
  }
}
