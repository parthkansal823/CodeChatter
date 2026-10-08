"use client";

import { findMatches, foldRegions, foldsHiding, splitTokens, tokenizeJsonLine, visibleLines, type JsonToken } from "@codechatter/contracts";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, ChevronUp, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const ROW = 20;
const OVERSCAN = 12;
/** Longer lines are cut for display; Raw and Copy still have all of it. */
const MAX_LINE = 2000;
const MATCH_CAP = 5000;

const KIND_CLASS: Record<JsonToken["kind"], string> = {
  key: "font-medium text-foreground",
  string: "text-foreground/85",
  number: "text-muted-foreground tabular-nums",
  keyword: "text-muted-foreground italic",
  punct: "text-muted-foreground",
  plain: "text-foreground",
};

/**
 * A response body as lines: virtualized so a multi-megabyte body stays
 * smooth, with search and (for JSON) folding of objects and arrays.
 */
export function LinesView({ text, mode, label }: { text: string; mode: "json" | "plain"; label: string }) {
  const lines = useMemo(() => text.split("\n"), [text]);
  const regions = useMemo(() => (mode === "json" ? foldRegions(lines) : new Map<number, number>()), [lines, mode]);
  const [folded, setFolded] = useState<ReadonlySet<number>>(() => new Set());
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(320);
  const scroller = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => findMatches(lines, query, MATCH_CAP), [lines, query]);
  const byLine = useMemo(() => {
    const map = new Map<number, Array<{ start: number; end: number; global: number }>>();
    matches.forEach((m, global) => map.set(m.line, [...(map.get(m.line) ?? []), { start: m.start, end: m.end, global }]));
    return map;
  }, [matches]);
  const visible = useMemo(() => visibleLines(lines.length, regions, folded), [lines.length, regions, folded]);
  const widest = useMemo(() => Math.min(MAX_LINE, lines.reduce((max, line) => Math.max(max, line.length), 0)), [lines]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const reveal = (line: number) => {
    const hiding = foldsHiding(line, regions, folded);
    let now = folded;
    if (hiding.length) {
      const copy = new Set(folded);
      for (const start of hiding) copy.delete(start);
      now = copy;
      setFolded(copy);
    }
    const row = visibleLines(lines.length, regions, now).indexOf(line);
    const el = scroller.current;
    if (el && row >= 0) el.scrollTop = Math.max(0, row * ROW - el.clientHeight / 2 + ROW);
  };

  const onQuery = (value: string) => {
    setQuery(value);
    setIndex(0);
    const first = findMatches(lines, value, 1)[0];
    if (first) reveal(first.line);
  };

  const step = (direction: 1 | -1) => {
    if (!matches.length) return;
    const next = (index + direction + matches.length) % matches.length;
    setIndex(next);
    reveal(matches[next]!.line);
  };

  const toggle = (line: number) => {
    const copy = new Set(folded);
    if (!copy.delete(line)) copy.add(line);
    setFolded(copy);
  };

  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN);
  const last = Math.min(visible.length, Math.ceil((scrollTop + height) / ROW) + OVERSCAN);
  const gutter = `${String(lines.length).length + 1}ch`;
  const foldable = regions.size > 0;

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
          event.preventDefault();
          search.current?.focus();
        }
      }}
    >
      <div className="flex h-8 shrink-0 items-center gap-1 border-b px-2">
        <div className="relative w-52 max-w-full">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            ref={search}
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                step(event.shiftKey ? -1 : 1);
              } else if (event.key === "Escape") onQuery("");
            }}
            placeholder="Search"
            aria-label={`Search ${label}`}
            spellCheck={false}
            className="h-6 pl-7 text-xs md:text-xs"
          />
        </div>
        {query && (
          <>
            <span role="status" className="min-w-14 text-xs text-muted-foreground tabular-nums">
              {matches.length ? `${index + 1} of ${matches.length}${matches.length >= MATCH_CAP ? "+" : ""}` : "No matches"}
            </span>
            <Button size="icon-xs" variant="ghost" aria-label="Previous match" disabled={!matches.length} onClick={() => step(-1)}>
              <ChevronUp />
            </Button>
            <Button size="icon-xs" variant="ghost" aria-label="Next match" disabled={!matches.length} onClick={() => step(1)}>
              <ChevronDown />
            </Button>
            <Button size="icon-xs" variant="ghost" aria-label="Clear search" onClick={() => onQuery("")}>
              <X />
            </Button>
          </>
        )}
        {foldable && (
          <div className="ml-auto flex items-center">
            <Button size="icon-xs" variant="ghost" aria-label="Collapse all" title="Collapse all" onClick={() => setFolded(new Set([...regions.keys()].filter((start) => start !== 0)))}>
              <ChevronsDownUp />
            </Button>
            <Button size="icon-xs" variant="ghost" aria-label="Expand all" title="Expand all" onClick={() => setFolded(new Set())}>
              <ChevronsUpDown />
            </Button>
          </div>
        )}
      </div>

      <div ref={scroller} role="region" aria-label={label} tabIndex={0} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} className="relative min-h-0 flex-1 overflow-auto">
        <div className="relative" style={{ height: visible.length * ROW, minWidth: `calc(${widest + 4}ch + ${gutter} + 2.5rem)` }}>
          {visible.slice(first, last).map((lineIndex, k) => {
            const line = lines[lineIndex]!;
            const closing = folded.has(lineIndex) ? regions.get(lineIndex) : undefined;
            const shown = line.length > MAX_LINE ? line.slice(0, MAX_LINE) : line;
            const tokens: JsonToken[] = mode === "json" ? tokenizeJsonLine(shown) : [{ text: shown, kind: "plain" }];
            if (line.length > MAX_LINE) tokens.push({ text: ` ... ${line.length - MAX_LINE} more characters`, kind: "punct" });
            if (closing !== undefined) tokens.push({ text: " ... ", kind: "punct" }, { text: lines[closing]!.trim(), kind: "punct" });
            const ranges = byLine.get(lineIndex) ?? [];
            const pieces = splitTokens(tokens, ranges);
            return (
              <div key={lineIndex} className="absolute left-0 flex h-5 min-w-full items-center font-mono text-sm leading-5 whitespace-pre" style={{ top: (first + k) * ROW }}>
                <span className="sticky left-0 z-sticky flex h-5 shrink-0 items-center gap-0.5 bg-background pr-2 pl-1 select-none" style={{ width: `calc(${gutter} + 1.5rem)` }}>
                  <span className="text-right text-xs text-muted-foreground/70 tabular-nums" style={{ width: gutter }}>
                    {lineIndex + 1}
                  </span>
                  {regions.has(lineIndex) ? (
                    <button
                      type="button"
                      aria-label={folded.has(lineIndex) ? `Unfold line ${lineIndex + 1}` : `Fold line ${lineIndex + 1}`}
                      aria-expanded={!folded.has(lineIndex)}
                      onClick={() => toggle(lineIndex)}
                      className="flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      {folded.has(lineIndex) ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                    </button>
                  ) : (
                    <span className="size-4" />
                  )}
                </span>
                <span>
                  {pieces.map((piece, i) => (
                    <span
                      key={i}
                      className={cn(
                        KIND_CLASS[piece.kind],
                        piece.hit >= 0 && (ranges[piece.hit]?.global === index ? "rounded-sm bg-brand text-brand-foreground" : "rounded-sm bg-warning/35 text-foreground"),
                      )}
                    >
                      {piece.text}
                    </span>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
