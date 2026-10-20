"use client";

import { X } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useEditorInfo } from "./active-editor";
import { kindLabel, SymbolIcon } from "./symbol-icon";
import { symbolsAt, type SymbolItem } from "./symbols";
import { revealSymbol, useOutline } from "./use-outline";

/**
 * The Outline view (it shares the sidebar with Files and Search): the symbols of the
 * file in the editor you last used, the ones the cursor is in marked, a filter, and a
 * click (or Enter) to go there.
 */
export function OutlineView() {
  const editor = useEditorInfo((state) => state.editor);
  const { symbols, supported, offset, file: name } = useOutline(editor);
  const [filter, setFilter] = useState("");
  const filterId = useId();

  const here = useMemo(() => new Set(symbols && offset !== null ? symbolsAt(symbols, offset) : []), [symbols, offset]);
  const shown = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!symbols || !query) return symbols;
    return symbols.filter((s) => s.name.toLowerCase().includes(query));
  }, [symbols, filter]);
  const deepest = [...here].at(-1);

  const go = (symbol: SymbolItem) => editor && revealSymbol(editor, symbol);
  const message = !editor || !name
    ? "Open a file to see its outline."
    : !supported
      ? "No outline for this language yet. Python, Markdown, Go, Rust, shell, TypeScript and JavaScript have one."
      : symbols === null
        ? "Reading the file…"
        : symbols.length === 0
          ? "No symbols in this file."
          : shown?.length === 0
            ? "Nothing matches the filter."
            : null;

  return (
    <section aria-label="Outline" className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-1 px-3">
        <span className="text-xs font-medium text-muted-foreground">Outline</span>
        {name && <span className="min-w-0 truncate text-xs text-muted-foreground">· {name}</span>}
      </div>
      <div className="shrink-0 px-3 pb-2">
        <div className="flex h-7 min-w-0 items-center rounded-md border border-input bg-background has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-1 has-[input:focus-visible]:outline-ring">
          <label htmlFor={filterId} className="sr-only">
            Filter symbols
          </label>
          <input
            id={filterId}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && filter) {
                e.preventDefault();
                setFilter("");
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                e.currentTarget.closest("section")?.querySelector<HTMLElement>("[data-outline-row]")?.focus();
              }
            }}
            placeholder="Filter symbols"
            type="text"
            spellCheck={false}
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground"
          />
          {filter && (
            <Button size="icon-xs" variant="ghost" aria-label="Clear the filter" className="mr-0.5" onClick={() => setFilter("")}>
              <X />
            </Button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {message ? (
          <p role="status" className="px-3 text-xs text-muted-foreground">
            {message}
          </p>
        ) : (
          <ul aria-label={`Symbols in ${name ?? "the file"}`} className="flex flex-col">
            {shown!.map((symbol, i) => {
              const current = symbol === deepest;
              return (
                <li key={`${symbol.start}-${i}`}>
                  <button
                    type="button"
                    data-outline-row
                    aria-current={current ? "location" : undefined}
                    title={`${kindLabel(symbol.kind)} ${symbol.name}`}
                    onClick={() => go(symbol)}
                    onKeyDown={(e) => {
                      const rows = [...(e.currentTarget.closest("ul")?.querySelectorAll<HTMLElement>("[data-outline-row]") ?? [])];
                      const at = rows.indexOf(e.currentTarget);
                      if (e.key === "ArrowDown") rows[at + 1]?.focus();
                      else if (e.key === "ArrowUp") (rows[at - 1] ?? e.currentTarget.closest("section")?.querySelector<HTMLElement>("input"))?.focus();
                      else return;
                      e.preventDefault();
                    }}
                    className={cn(
                      "flex h-row w-full items-center gap-1.5 pr-3 text-left text-xs outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset",
                      here.has(symbol) && "text-foreground",
                      !here.has(symbol) && "text-muted-foreground",
                      current && "bg-accent/60 font-medium",
                    )}
                    style={{ paddingLeft: 12 + (filter.trim() ? 0 : symbol.depth * 12) }}
                  >
                    <SymbolIcon kind={symbol.kind} className={cn(here.has(symbol) && "text-foreground")} />
                    <span className="min-w-0 truncate">{symbol.name}</span>
                    <span className="ml-auto shrink-0 pl-2 text-2xs text-muted-foreground">{kindLabel(symbol.kind)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
