"use client";

import { ChevronRight, FileText, ReplaceAll } from "lucide-react";
import type { KeyboardEvent } from "react";

import { dirOf } from "@/components/room/editor/room-files";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { FileMatches, Match } from "./search";

const ROW_FOCUS =
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset";

type Props = {
  files: FileMatches[];
  collapsed: Set<string>;
  onToggle: (fileId: string, open?: boolean) => void;
  onOpen: (file: FileMatches, match: Match) => void;
  /** Set for people who can edit files while the replace box is open. */
  onReplaceFile?: (file: FileMatches) => void;
};

/**
 * The results, grouped by file: a row per file (its name, folder and count),
 * then a row per match with the line around it. Up and Down move between rows,
 * Left and Right fold a file.
 */
export function SearchResultsList({ files, collapsed, onToggle, onOpen, onReplaceFile }: Props) {
  const move = (event: KeyboardEvent<HTMLUListElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-result-row]")];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    if (at === -1) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? rows.length - 1
          : Math.min(rows.length - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)));
    rows[next]?.focus();
  };

  return (
    <ul aria-label="Search results" onKeyDown={move}>
      {files.map((file) => {
        const open = !collapsed.has(file.id);
        const name = file.path.slice(file.path.lastIndexOf("/") + 1);
        const dir = dirOf(file.path);
        const count = file.matches.length;
        return (
          <li key={file.id}>
            <div className="group flex h-row items-center pr-1 hover:bg-accent">
              <button
                type="button"
                data-result-row
                aria-expanded={open}
                aria-label={`${name}${dir ? ` in ${dir}` : ""}, ${count} ${count === 1 ? "result" : "results"}`}
                onClick={() => onToggle(file.id)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault();
                    onToggle(file.id, event.key === "ArrowRight");
                  }
                }}
                className={cn(
                  "flex h-full min-w-0 flex-1 items-center gap-1.5 overflow-hidden pl-2 text-left text-sm",
                  ROW_FOCUS,
                )}
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                    open && "rotate-90",
                  )}
                />
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="max-w-full shrink-0 truncate">{name}</span>
                {dir && <span className="min-w-0 truncate text-xs text-muted-foreground">{dir}</span>}
              </button>
              {onReplaceFile && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Replace all in ${file.path}`}
                  title="Replace all in this file"
                  onClick={() => onReplaceFile(file)}
                  className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                >
                  <ReplaceAll />
                </Button>
              )}
              <span
                aria-hidden
                className="ml-1 min-w-5 rounded-full bg-secondary px-1.5 text-center text-2xs text-muted-foreground tabular-nums"
              >
                {count}
              </span>
            </div>
            {open && (
              <ul>
                {file.matches.map((match) => (
                  <li key={`${match.line}:${match.column}`}>
                    <MatchRow match={match} onOpen={() => onOpen(file, match)} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** One match: the line around it, the match marked, or struck through before what replaces it. */
function MatchRow({ match, onOpen }: { match: Match; onOpen: () => void }) {
  const lead = match.before.trimEnd();
  const replacement = match.replacement?.replace(/\r?\n/g, "↵");
  const line = `${match.before}${match.text}${match.after}`;
  const becomes = replacement === undefined ? "" : `, becomes ${match.before}${replacement}${match.after}`;
  return (
    <button
      type="button"
      data-result-row
      onClick={onOpen}
      aria-label={`Line ${match.line}: ${line}${becomes}`}
      title={`Line ${match.line}, column ${match.column}`}
      className={cn(
        "flex h-row w-full min-w-0 items-center pr-2 pl-9 text-left font-mono text-xs whitespace-pre text-muted-foreground hover:bg-accent tab-2",
        ROW_FOCUS,
      )}
    >
      {/* The match stays in sight in a narrow sidebar: the text before it gives way first, from its
          start, with an ellipsis there (a right-to-left box around a left-to-right run). Its
          trailing space stays outside, where bidi can't move it to the far end. */}
      <span dir="rtl" className="min-w-0 shrink overflow-hidden text-ellipsis">
        <bdi dir="ltr">{lead}</bdi>
      </span>
      <span className="shrink-0">{match.before.slice(lead.length)}</span>
      <span className="max-w-full shrink-0 overflow-hidden text-ellipsis">
        {replacement === undefined ? (
          <mark className="rounded-[2px] bg-brand-muted text-foreground">{match.text}</mark>
        ) : (
          <>
            <del className="bg-destructive/20 text-foreground decoration-destructive/70">{match.text}</del>
            <ins className="bg-success/25 text-foreground no-underline">{replacement}</ins>
          </>
        )}
      </span>
      <span className="min-w-0 flex-[1_1_0] overflow-hidden text-ellipsis">{match.after}</span>
    </button>
  );
}
