"use client";

import { maps, textOf, type TreeNode } from "@codechatter/workspace-model";
import {
  CaseSensitive,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Regex,
  ReplaceAll,
  WholeWord,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { revealInFile } from "@/components/room/editor/reveal";
import { useRoomFiles } from "@/components/room/editor/room-files";
import { useRoom } from "@/components/room/room-context";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { applyReplace } from "./replace";
import {
  buildPattern,
  MAX_MATCHES,
  pathFilter,
  planReplace,
  searchFiles,
  type FileMatches,
  type Match,
  type SearchResults,
} from "./search";
import { SearchResultsList } from "./search-results";
import { useSearch } from "./search-store";

/** Typing waits this long for a pause; so do edits to the room's files. */
const DEBOUNCE_MS = 250;

const counted = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

type Option = "matchCase" | "wholeWord" | "regex";

/**
 * The Search view in the left sidebar (Ctrl+Shift+F): find text in every file
 * of the room and replace it. It searches the files document this browser
 * already holds, so nothing goes to the server, and results follow everyone's
 * edits. Replacing is for people who can edit files.
 */
export function SearchView({ onOpen }: { onOpen: (node: TreeNode) => void }) {
  const { doc, can } = useRoom();
  const files = useRoomFiles();
  const canEdit = can("files.edit");
  const search = useSearch();
  const replacing = canEdit && search.showReplace;
  const [results, setResults] = useState<SearchResults | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [confirm, setConfirm] = useState<{ count: number; files: number } | null>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const replaceBox = useRef<HTMLInputElement>(null);
  const ids = useId();

  // A regex that doesn't parse says so as you type; the search itself waits for a pause.
  const pattern = buildPattern(search);
  const error = pattern && "error" in pattern ? pattern.error : null;

  const latest = useRef({ files, replacing });
  useEffect(() => {
    latest.current = { files, replacing };
  });
  const run = useCallback(() => {
    const state = useSearch.getState();
    const built = buildPattern(state);
    if (!built || "error" in built) return setResults(null);
    const current = latest.current;
    setResults(
      searchFiles(current.files, (id) => textOf(doc, id), built, {
        filter: pathFilter(state.include, state.exclude),
        replace: current.replacing ? { text: state.replace, regex: state.regex } : undefined,
      }),
    );
  }, [doc]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const schedule = useCallback(
    (delay: number) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(run, delay);
    },
    [run],
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  // Typed fields wait for a pause; the options and the file list apply at once.
  useEffect(
    () => schedule(DEBOUNCE_MS),
    [schedule, search.query, search.include, search.exclude, search.replace],
  );
  useEffect(
    () => schedule(0),
    [schedule, search.matchCase, search.wholeWord, search.regex, replacing, files],
  );
  // Anyone's edit to any file updates the results, once the typing pauses.
  useEffect(() => {
    const contents = maps(doc).contents;
    const changed = () => {
      if (useSearch.getState().query) schedule(DEBOUNCE_MS);
    };
    contents.observeDeep(changed);
    return () => contents.unobserveDeep(changed);
  }, [doc, schedule]);

  // Ctrl+Shift+F, the command palette or the activity bar asked for a box. Once
  // more on the next task: a dialog that just closed (the palette) hands focus
  // back to where it was a moment later.
  useEffect(() => {
    const field = search.focus;
    if (!field) return;
    const put = () => {
      const box = (field === "replace" && replaceBox.current) || searchBox.current;
      box?.focus();
      box?.select();
    };
    put();
    setTimeout(put, 0);
    useSearch.getState().set({ focus: null });
  }, [search.focus]);

  const toggleOption = (option: Option) => {
    const state = useSearch.getState();
    if (option === "matchCase") state.set({ matchCase: !state.matchCase });
    else if (option === "wholeWord") state.set({ wholeWord: !state.wholeWord });
    else state.set({ regex: !state.regex });
  };
  const openMatch = (file: FileMatches, match: Match) => {
    const node = files.find((f) => f.id === file.id);
    if (!node) return;
    onOpen(node);
    revealInFile(node, {
      startLine: match.line,
      startColumn: match.column,
      endLine: match.endLine,
      endColumn: match.endColumn,
    });
  };

  /** What a replace would change now, in every file the search covers, or only in `only`. */
  const plan = (only?: string) => {
    const state = useSearch.getState();
    const built = buildPattern(state);
    if (!built || "error" in built) return [];
    const scope = only ? files.filter((file) => file.id === only) : files;
    const filter = only ? undefined : pathFilter(state.include, state.exclude);
    return planReplace(
      scope,
      (id) => textOf(doc, id),
      built,
      { text: state.replace, regex: state.regex },
      filter,
    );
  };
  const askReplaceAll = () => {
    const edits = plan();
    if (edits.length > 0)
      setConfirm({ count: edits.reduce((n, file) => n + file.edits.length, 0), files: edits.length });
  };
  const replaceAll = () => {
    setConfirm(null);
    // Planned again: the files may have changed while the question was open.
    const edits = plan();
    const count = edits.reduce((n, file) => n + file.edits.length, 0);
    if (count > 0)
      applyReplace(
        doc,
        edits,
        `Replaced ${counted(count, "match", "matches")} in ${counted(edits.length, "file")}`,
      );
  };
  const replaceInFile = (file: FileMatches) => {
    const edits = plan(file.id);
    const count = edits[0]?.edits.length ?? 0;
    const name = file.path.slice(file.path.lastIndexOf("/") + 1);
    if (count > 0) applyReplace(doc, edits, `Replaced ${counted(count, "match", "matches")} in ${name}`);
  };

  const filtering = Boolean(search.include.trim() || search.exclude.trim());
  const allCollapsed =
    results !== null && results.files.length > 0 && results.files.every((f) => collapsed.has(f.id));
  const onViewKey = (event: KeyboardEvent<HTMLElement>) => {
    // Alt+C, Alt+W and Alt+R flip the options, as in VS Code (Cmd+Option on a Mac, where Option types letters).
    const mac = /Mac|iPhone|iPad/.test(navigator.userAgent);
    if (!event.altKey || event.ctrlKey || event.shiftKey || event.metaKey !== mac) return;
    const option: Option | null =
      event.code === "KeyC"
        ? "matchCase"
        : event.code === "KeyW"
          ? "wholeWord"
          : event.code === "KeyR"
            ? "regex"
            : null;
    if (!option) return;
    event.preventDefault();
    toggleOption(option);
  };

  return (
    <section
      aria-label="Search"
      data-search-view
      onKeyDown={onViewKey}
      className="flex h-full min-h-0 flex-col bg-panel"
    >
      <div className="flex h-9 shrink-0 items-center gap-1 px-3">
        <span className="text-xs font-medium text-muted-foreground">Search</span>
        <div className="ml-auto flex">
          {results && results.files.length > 0 && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={allCollapsed ? "Expand all" : "Collapse all"}
              title={allCollapsed ? "Expand all" : "Collapse all"}
              onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(results.files.map((f) => f.id)))}
            >
              {allCollapsed ? <ChevronsUpDown /> : <ChevronsDownUp />}
            </Button>
          )}
          {(search.query || search.replace) && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Clear the search"
              title="Clear the search"
              onClick={() => {
                search.set({ query: "", replace: "", focus: "search" });
                setCollapsed(new Set());
              }}
            >
              <X />
            </Button>
          )}
        </div>
      </div>

      <div className={cn("shrink-0 pr-3 pb-2", canEdit ? "pl-1.5" : "pl-3")}>
        <div className="flex gap-0.5">
          {canEdit && (
            <button
              type="button"
              aria-label="Toggle replace"
              aria-expanded={search.showReplace}
              title="Toggle replace (Ctrl+Shift+H)"
              onClick={() => search.set({ showReplace: !search.showReplace })}
              className="flex w-4 shrink-0 items-start justify-center rounded-sm pt-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ChevronRight
                className={cn(
                  "size-3.5 transition-transform duration-150",
                  search.showReplace && "rotate-90",
                )}
              />
            </button>
          )}
          <div className="grid min-w-0 flex-1 gap-1.5">
            <Field invalid={Boolean(error)}>
              <input
                ref={searchBox}
                value={search.query}
                onChange={(e) => search.set({ query: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    schedule(0);
                  } else if (e.key === "ArrowDown") {
                    // Down from the box goes into the results.
                    const first = e.currentTarget
                      .closest("[data-search-view]")
                      ?.querySelector<HTMLElement>("[data-result-row]");
                    if (first) {
                      e.preventDefault();
                      first.focus();
                    }
                  }
                }}
                placeholder="Search"
                aria-label="Search"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${ids}-error` : undefined}
                {...TEXT_INPUT}
              />
              <div className="flex shrink-0 items-center gap-px pr-0.5">
                <OptionToggle
                  label="Match case"
                  keys="Alt+C"
                  pressed={search.matchCase}
                  onToggle={() => toggleOption("matchCase")}
                >
                  <CaseSensitive />
                </OptionToggle>
                <OptionToggle
                  label="Whole word"
                  keys="Alt+W"
                  pressed={search.wholeWord}
                  onToggle={() => toggleOption("wholeWord")}
                >
                  <WholeWord />
                </OptionToggle>
                <OptionToggle
                  label="Use regular expression"
                  keys="Alt+R"
                  pressed={search.regex}
                  onToggle={() => toggleOption("regex")}
                >
                  <Regex />
                </OptionToggle>
              </div>
            </Field>
            {error && (
              <p id={`${ids}-error`} className="-mt-0.5 text-xs text-destructive">
                {error}
              </p>
            )}
            {replacing && (
              <div className="flex items-center gap-1">
                <Field className="flex-1">
                  <input
                    ref={replaceBox}
                    value={search.replace}
                    onChange={(e) => search.set({ replace: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.altKey) {
                        e.preventDefault();
                        askReplaceAll();
                      }
                    }}
                    placeholder={search.regex ? "Replace ($1 for a group)" : "Replace"}
                    aria-label="Replace"
                    {...TEXT_INPUT}
                  />
                </Field>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Replace all"
                  title="Replace all (Ctrl+Alt+Enter)"
                  disabled={!results || results.count === 0}
                  onClick={askReplaceAll}
                >
                  <ReplaceAll />
                </Button>
              </div>
            )}
          </div>
        </div>
        <div className={cn("mt-1.5 grid gap-1.5", canEdit && "pl-4.5")}>
          <button
            type="button"
            aria-expanded={search.showFilters}
            aria-controls={search.showFilters ? `${ids}-filters` : undefined}
            onClick={() => search.set({ showFilters: !search.showFilters })}
            className="flex h-5 items-center gap-1 justify-self-start rounded-sm text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronRight
              className={cn("size-3 transition-transform duration-150", search.showFilters && "rotate-90")}
            />
            Files to include and exclude
            {!search.showFilters && filtering && <span className="text-foreground">(in use)</span>}
          </button>
          {search.showFilters && (
            <div id={`${ids}-filters`} className="grid gap-1.5">
              <GlobField
                label="Files to include"
                placeholder="e.g. src/**/*.ts, *.md"
                value={search.include}
                onChange={(include) => search.set({ include })}
                onEnter={() => schedule(0)}
              />
              <GlobField
                label="Files to exclude"
                placeholder="e.g. **/*.test.ts, dist"
                value={search.exclude}
                onChange={(exclude) => search.set({ exclude })}
                onEnter={() => schedule(0)}
              />
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        <p role="status" className="px-3 pb-1.5 text-xs text-muted-foreground empty:pb-0">
          {results && search.query ? summary(results, filtering) : null}
        </p>
        {results && search.query && results.files.length > 0 && (
          <SearchResultsList
            files={results.files}
            collapsed={collapsed}
            onToggle={(id, open) =>
              setCollapsed((current) => {
                const next = new Set(current);
                if (open ?? next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onOpen={openMatch}
            onReplaceFile={replacing ? replaceInFile : undefined}
          />
        )}
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Replace {confirm && counted(confirm.count, "match", "matches")} in{" "}
              {confirm && counted(confirm.files, "file")}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {search.replace
                ? `Each match of “${search.query}” becomes “${search.replace}”, for everyone in the room.`
                : `Each match of “${search.query}” is deleted, for everyone in the room.`}{" "}
              You can undo it for ten seconds afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
            <AlertDialogAction size="sm" onClick={replaceAll}>
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** "12 results in 3 files", or why there are none or no more, and any files too big to search. */
function summary(results: SearchResults, filtering: boolean): string {
  const n = results.skipped;
  const skipped = n ? ` ${counted(n, "file")} over 1 MB ${n === 1 ? "wasn't" : "weren't"} searched.` : "";
  const files = counted(results.files.length, "file");
  if (results.count === 0)
    return `${filtering ? "No results found in the files to include and exclude." : "No results found."}${skipped}`;
  if (results.capped)
    return `Showing the first ${counted(MAX_MATCHES, "result")}, in ${files}. Narrow the search to see the rest.${skipped}`;
  return `${counted(results.count, "result")} in ${files}${skipped && `.${skipped}`}`;
}

const TEXT_INPUT = {
  type: "text",
  spellCheck: false,
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  className:
    "h-full min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground",
} as const;

/** A dense text box; its outline shows while the input inside has focus. */
function Field({
  invalid,
  className,
  children,
}: {
  invalid?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-7 min-w-0 items-center rounded-md border border-input bg-background has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-1 has-[input:focus-visible]:outline-ring",
        invalid && "border-destructive",
        className,
      )}
    >
      {children}
    </div>
  );
}

function GlobField({
  label,
  placeholder,
  value,
  onChange,
  onEnter,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onEnter: () => void;
}) {
  const id = useId();
  return (
    <div className="grid gap-0.5">
      <label htmlFor={id} className="text-2xs text-muted-foreground">
        {label}
      </label>
      <Field>
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onEnter();
            }
          }}
          placeholder={placeholder}
          {...TEXT_INPUT}
        />
      </Field>
    </div>
  );
}

/** One of the three options inside the search box, as a pressed-or-not button. */
function OptionToggle({
  label,
  keys,
  pressed,
  onToggle,
  children,
}: {
  label: string;
  keys: string;
  pressed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={`${label} (${keys})`}
      onClick={onToggle}
      className={cn(
        "flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3.5",
        pressed && "bg-brand-muted text-foreground ring-1 ring-brand/60 ring-inset hover:bg-brand-muted",
      )}
    >
      {children}
    </button>
  );
}
