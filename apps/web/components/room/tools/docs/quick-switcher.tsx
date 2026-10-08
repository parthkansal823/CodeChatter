"use client";

import { CalendarDays, FilePlus2, FileText, Waypoints } from "lucide-react";
import { useState } from "react";

import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

import { useDocs } from "./docs-context";
import { ancestorsOf, titleOf } from "./pages-model";

/** Ctrl+K inside the docs tool: jump to a page, or create one with the typed title. */
export function QuickSwitcher({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const docs = useDocs();
  const [query, setQuery] = useState("");
  const title = query.trim();
  const exact = docs.live.some((page) => titleOf(page).toLowerCase() === title.toLowerCase());
  const pages = [...docs.live].sort((a, b) => b.updatedAt - a.updatedAt);

  const run = (action: () => void) => {
    onOpenChange(false);
    setQuery("");
    action();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value);
        if (!value) setQuery("");
      }}
      title="Search pages"
      description="Find a page by its title, or create one"
      className="sm:max-w-lg"
    >
      <CommandInput value={query} onValueChange={setQuery} placeholder="Search pages" />
      <CommandList>
        <CommandEmpty>No pages match.</CommandEmpty>
        {pages.length > 0 && (
          <CommandGroup heading="Pages">
            {pages.map((page) => {
              const path = ancestorsOf(page.id, docs.byId).map(titleOf).join(" / ");
              return (
                <CommandItem key={page.id} value={page.id} keywords={[titleOf(page), path]} onSelect={() => run(() => docs.openPage(page.id))}>
                  {page.icon ? <span aria-hidden className="w-4 text-center">{page.icon}</span> : <FileText />}
                  <span className="truncate">{titleOf(page)}</span>
                  {path && <span className="ml-auto truncate text-xs text-muted-foreground">{path}</span>}
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        <CommandGroup heading="Actions">
          {docs.editable && title && !exact && (
            <CommandItem value="create-page" forceMount onSelect={() => run(() => docs.newPage({ title }))}>
              <FilePlus2 /> Create page &ldquo;{title}&rdquo;
            </CommandItem>
          )}
          {docs.editable && (
            <CommandItem value="today" keywords={["daily note today journal"]} onSelect={() => run(docs.openDaily)}>
              <CalendarDays /> Open today&apos;s note
            </CommandItem>
          )}
          <CommandItem value="graph" keywords={["graph view links map"]} onSelect={() => run(() => docs.setView("graph"))}>
            <Waypoints /> Open the graph
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
