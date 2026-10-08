"use client";

import { Calendar, CalendarDays, ChevronLeft, ChevronRight, FileText, Hash, Plus, RotateCcw, Search, Star, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

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
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useDocs } from "./docs-context";
import { useRoomDocsState } from "./docs-store";
import { NewPageMenu } from "./page-menus";
import { PageTree } from "./page-tree";
import { ancestorsOf, buildTree, dailyId, deletePageForever, movePage, restorePage, titleOf, type PageRecord } from "./pages-model";
import { addMonths, monthGrid, monthKey, monthLabel, today, WEEKDAYS } from "./calendar";
import { tagCounts } from "./tags";

/** Favourites, the page tree, daily notes and the trash. */
export function PageSidebar() {
  const docs = useDocs();
  const { favourites } = useRoomDocsState(docs.roomId);
  const tree = useMemo(() => buildTree(docs.pages), [docs.pages]);
  const pageRoots = tree.filter((node) => node.kind === "page");
  const dailyRoots = tree.filter((node) => node.kind === "daily").sort((a, b) => b.id.localeCompare(a.id));
  const starred = favourites.map((id) => docs.byId.get(id)).filter((page): page is PageRecord => Boolean(page && docs.isLive(page.id)));
  const [rootDrop, setRootDrop] = useState(false);
  const tags = useMemo(() => tagCounts(docs.live), [docs.live]);
  const { activeTag, openTag } = docs;
  const tagged = activeTag ? docs.live.filter((page) => page.tags.includes(activeTag)).sort((a, b) => b.updatedAt - a.updatedAt) : [];
  const noteDays = useMemo(() => new Set(docs.live.filter((page) => page.kind === "daily").map((page) => page.id)), [docs.live]);

  return (
    <aside aria-label="Pages" className="flex w-60 shrink-0 flex-col border-r bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b pr-1.5 pl-3">
        <span className="text-xs font-medium text-muted-foreground">Docs</span>
        {docs.editable && (
          <div className="ml-auto flex">
            <Button variant="ghost" size="icon-xs" aria-label="Open today's note" title="Today's note" onClick={docs.openDaily}>
              <CalendarDays />
            </Button>
            <NewPageMenu>
              <Button variant="ghost" size="icon-xs" aria-label="New page">
                <Plus />
              </Button>
            </NewPageMenu>
          </div>
        )}
      </div>
      <div className="p-2">
        <button
          type="button"
          onClick={docs.openSwitcher}
          className="flex h-7 w-full items-center gap-2 rounded-md border bg-background px-2 text-left text-sm text-muted-foreground hover:text-foreground"
        >
          <Search className="size-3.5" />
          <span className="flex-1">Search pages</span>
          <Kbd>Ctrl K</Kbd>
        </button>
      </div>
      <nav data-docs-nav aria-label="Page list" className="min-h-0 flex-1 overflow-y-auto pb-3">
        {activeTag && (
          <Section
            title={`Tagged #${activeTag}`}
            action={
              <Button variant="ghost" size="icon-xs" aria-label="Clear the tag filter" onClick={() => openTag(activeTag)}>
                <X />
              </Button>
            }
          >
            {tagged.length === 0 ? (
              <p className="px-3 py-1 text-xs text-muted-foreground">No pages carry this tag any more.</p>
            ) : (
              <ul>
                {tagged.map((page) => (
                  <li key={page.id}>
                    <FlatRow page={page} icon={<Hash className="size-3.5" />} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}
        {starred.length > 0 && (
          <Section title="Favourites">
            <ul>
              {starred.map((page) => (
                <li key={page.id}>
                  <FlatRow page={page} icon={<Star className="size-3.5" />} />
                </li>
              ))}
            </ul>
          </Section>
        )}
        <Section
          title="Pages"
          className={cn(rootDrop && "bg-brand-muted/40")}
          onDragOver={(e) => {
            if (!docs.editable || !e.dataTransfer.types.includes("text/cc-page")) return;
            e.preventDefault();
            setRootDrop(true);
          }}
          onDragLeave={() => setRootDrop(false)}
          onDrop={(e) => {
            e.preventDefault();
            setRootDrop(false);
            const id = e.dataTransfer.getData("text/cc-page");
            if (id) movePage(docs.indexDoc, id, null);
          }}
        >
          <PageTree nodes={pageRoots} label="Pages" empty={docs.editable ? "No pages yet." : "No pages in this room yet."} />
        </Section>
        {(dailyRoots.length > 0 || docs.editable) && (
          <Section title="Daily notes" action={<DayPicker notes={noteDays} />}>
            <PageTree nodes={dailyRoots} label="Daily notes" empty="No daily notes yet." />
          </Section>
        )}
        {tags.length > 0 && (
          <Section title="Tags">
            <ul aria-label="Tags" className="flex flex-wrap gap-1 px-3 pt-0.5">
              {tags.map(({ tag, count }) => (
                <li key={tag}>
                  <button
                    type="button"
                    aria-pressed={activeTag === tag}
                    onClick={() => openTag(tag)}
                    className={cn(
                      "inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-xs",
                      activeTag === tag ? "border-foreground text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    #{tag}
                    <span className="text-muted-foreground tabular-nums">{count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </nav>
      <TrashSection />
    </aside>
  );
}

function Section({ title, action, className, children, ...rest }: { title: string; action?: React.ReactNode } & React.ComponentProps<"section">) {
  return (
    <section aria-label={title} className={cn("pt-2", className)} {...rest}>
      <div className="flex min-h-5 items-center gap-1 pr-1.5 pb-1 pl-3">
        <h3 className="flex-1 truncate text-xs font-medium text-muted-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A month of days: days with a note are dotted, and picking a day opens its note (or starts it, if you can edit). */
function DayPicker({ notes }: { notes: Set<string> }) {
  const { openDay, editable } = useDocs();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => monthKey(today()));
  const now = today();
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setMonth(monthKey(today()));
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="Pick a day">
          <Calendar />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="mb-1 flex items-center">
          <span className="flex-1 pl-1 text-sm font-medium">{monthLabel(month)}</span>
          <Button variant="ghost" size="icon-xs" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
            <ChevronRight />
          </Button>
        </div>
        <table className="w-full table-fixed text-center text-xs">
          <thead>
            <tr>
              {WEEKDAYS.map((day) => (
                <th key={day} scope="col" className="pb-1 font-normal text-muted-foreground">
                  {day.slice(0, 2)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {monthGrid(month).map((week) => (
              <tr key={week[0]}>
                {week.map((day) => {
                  const has = notes.has(dailyId(day));
                  return (
                    <td key={day} className="p-px">
                      <button
                        type="button"
                        disabled={!has && !editable}
                        aria-label={has ? `${day}, has a note` : day}
                        aria-current={day === now ? "date" : undefined}
                        onClick={() => {
                          openDay(day);
                          setOpen(false);
                        }}
                        className={cn(
                          "relative h-7 w-full rounded-md tabular-nums hover:bg-accent disabled:pointer-events-none disabled:opacity-40",
                          monthKey(day) !== month && "text-muted-foreground",
                          day === now && "font-semibold ring-1 ring-brand ring-inset",
                        )}
                      >
                        {Number(day.slice(8))}
                        {has && <span aria-hidden className="absolute bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-foreground/70" />}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </PopoverContent>
    </Popover>
  );
}

function FlatRow({ page, icon }: { page: PageRecord; icon: React.ReactNode }) {
  const { openPage, currentId, view } = useDocs();
  const active = page.id === currentId && view === "page";
  return (
    <button
      type="button"
      onClick={() => openPage(page.id)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-7 w-full items-center gap-2 px-3 text-left text-sm hover:bg-accent",
        active ? "bg-accent text-foreground" : "text-muted-foreground",
      )}
    >
      {page.icon ? <span aria-hidden className="w-4 text-center">{page.icon}</span> : icon}
      <span className="truncate">{titleOf(page)}</span>
    </button>
  );
}

/** Top-level trashed pages (a trashed page's children go and come back with it). */
function TrashSection() {
  const docs = useDocs();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<PageRecord | null>(null);
  const trashed = docs.pages
    .filter((p) => p.trashedAt !== null && !ancestorsOf(p.id, docs.byId).some((a) => a.trashedAt !== null))
    .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));

  return (
    <div className="shrink-0 border-t">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-8 w-full items-center gap-1.5 px-3 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")} />
        <Trash2 className="size-3.5" />
        Trash
        {trashed.length > 0 && <span className="ml-auto tabular-nums">{trashed.length}</span>}
      </button>
      {open && (
        <ul aria-label="Trash" className="max-h-56 overflow-y-auto pb-2">
          {trashed.length === 0 && <li className="px-3 py-1 text-xs text-muted-foreground">Nothing in the trash.</li>}
          {trashed.map((page) => (
            <li key={page.id} className="group flex h-7 items-center gap-1 pr-1 pl-3 hover:bg-accent">
              <button type="button" onClick={() => docs.openPage(page.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-muted-foreground">
                {page.icon ? <span aria-hidden>{page.icon}</span> : <FileText aria-hidden className="size-3.5 shrink-0" />}
                <span className="truncate">{titleOf(page)}</span>
                <span className="ml-auto shrink-0 text-2xs">{formatRelativeTime(new Date(page.trashedAt ?? 0))}</span>
              </button>
              {docs.editable && (
                <>
                  <Button variant="ghost" size="icon-xs" aria-label={`Restore ${titleOf(page)}`} onClick={() => restorePage(docs.indexDoc, page.id)}>
                    <RotateCcw />
                  </Button>
                  <Button variant="ghost" size="icon-xs" aria-label={`Delete ${titleOf(page)} forever`} onClick={() => setConfirm(page)}>
                    <Trash2 />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <AlertDialog open={confirm !== null} onOpenChange={(value) => !value && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirm ? titleOf(confirm) : "page"} forever?</AlertDialogTitle>
            <AlertDialogDescription>
              The page and the pages inside it leave the room for everyone. Links to them show as deleted. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
            <AlertDialogAction
              size="sm"
              variant="destructive"
              onClick={() => {
                if (confirm) deletePageForever(docs.indexDoc, confirm.id);
                setConfirm(null);
              }}
            >
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
