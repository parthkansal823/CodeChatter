"use client";

import { FileText } from "lucide-react";

import { useDocs } from "./docs-context";
import { ancestorsOf, titleOf } from "./pages-model";

/** Pages that link here, read from the index (no other page documents are loaded). */
export function Backlinks({ pageId }: { pageId: string }) {
  const { live, byId, openPage } = useDocs();
  const linking = live.filter((page) => page.id !== pageId && page.links.includes(pageId)).sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <section aria-labelledby="docs-backlinks" className="mt-10 border-t pt-4">
      <h2 id="docs-backlinks" className="text-xs font-medium text-muted-foreground">
        {linking.length === 0 ? "Backlinks" : `Linked from ${linking.length} ${linking.length === 1 ? "page" : "pages"}`}
      </h2>
      {linking.length === 0 ? (
        <p className="mt-1.5 text-sm text-muted-foreground">No pages link here yet. Type [[ in another page to link to this one.</p>
      ) : (
        <ul className="mt-1.5 grid gap-0.5">
          {linking.map((page) => {
            const path = ancestorsOf(page.id, byId).map(titleOf).join(" / ");
            return (
              <li key={page.id}>
                <button
                  type="button"
                  onClick={() => openPage(page.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent"
                >
                  {page.icon ? <span aria-hidden>{page.icon}</span> : <FileText aria-hidden className="size-3.5 text-muted-foreground" />}
                  <span className="truncate">{titleOf(page)}</span>
                  {path && <span className="truncate text-xs text-muted-foreground">in {path}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
