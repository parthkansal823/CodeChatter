"use client";

import type { HocuspocusProvider } from "@hocuspocus/provider";
import { ChevronRight, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";

import { PresenceAvatar } from "@/components/presence/presence";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/format";

import { useAwarenessPeers } from "./connection";
import { useDocs } from "./docs-context";
import { IconPicker } from "./icon-picker";
import { ancestorsOf, restorePage, titleOf, UNTITLED, updatePage, type PageRecord } from "./pages-model";

export function Breadcrumbs({ page }: { page: PageRecord }) {
  const { byId, openPage } = useDocs();
  const chain = ancestorsOf(page.id, byId);
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-0.5 px-1 text-sm">
      {chain.map((parent) => (
        <span key={parent.id} className="flex min-w-0 shrink items-center gap-0.5">
          <button type="button" onClick={() => openPage(parent.id)} className="truncate rounded-sm px-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            {parent.icon && (
              <span aria-hidden className="mr-1">
                {parent.icon}
              </span>
            )}
            {titleOf(parent)}
          </button>
          <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        </span>
      ))}
      <span aria-current="page" className="truncate px-1 font-medium">
        {page.icon && (
          <span aria-hidden className="mr-1">
            {page.icon}
          </span>
        )}
        {titleOf(page)}
      </span>
    </nav>
  );
}

/** The title lives in the page index, so the tree and links update as it's typed. */
export function PageTitle({ page, onEnter }: { page: PageRecord; onEnter?: () => void }) {
  const { editable, indexDoc, focusTitle, clearFocusTitle } = useDocs();
  // While you type, your own text wins over the index (no caret jumps); others see each keystroke.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <header className="group/title mb-4">
      <IconPicker icon={page.icon} editable={editable} onChange={(icon) => updatePage(indexDoc, page.id, { icon })} />
      <textarea
        aria-label="Page title"
        rows={1}
        value={draft ?? page.title}
        readOnly={!editable}
        placeholder={UNTITLED}
        autoFocus={focusTitle === page.id}
        onFocus={(e) => {
          setDraft(page.title);
          if (focusTitle === page.id) {
            e.currentTarget.select();
            clearFocusTitle();
          }
        }}
        onBlur={() => setDraft(null)}
        onChange={(e) => {
          const title = e.target.value.replace(/\n/g, " ");
          setDraft(title);
          updatePage(indexDoc, page.id, { title });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter?.();
          }
        }}
        className="block w-full resize-none bg-transparent text-[1.9rem] leading-tight font-semibold tracking-tight outline-none field-sizing-content placeholder:text-muted-foreground/50 focus-visible:outline-none"
      />
      {page.updatedAt > 0 && <p className="mt-1.5 text-xs text-muted-foreground">Edited {formatRelativeTime(new Date(page.updatedAt))}</p>}
    </header>
  );
}

/** Everyone else with this page open. */
export function PagePeers({ provider }: { provider: HocuspocusProvider }) {
  const peers = useAwarenessPeers(provider);
  if (peers.length === 0) return null;
  return (
    <div className="mr-1 flex items-center gap-1" aria-label={`${peers.length} ${peers.length === 1 ? "other person" : "other people"} on this page`}>
      {peers.slice(0, 4).map((peer) => (
        <PresenceAvatar key={peer.user.id} name={peer.user.name} image={peer.user.image} slot={peer.user.slot} size={20} />
      ))}
      {peers.length > 4 && <span className="text-xs text-muted-foreground">+{peers.length - 4}</span>}
    </div>
  );
}

/** Shown on a page that is in the trash, or inside one. */
export function TrashBanner({ page }: { page: PageRecord }) {
  const { editable, indexDoc } = useDocs();
  return (
    <div role="status" className="flex shrink-0 items-center gap-2 border-b bg-panel px-4 py-1.5 text-sm">
      <Trash2 aria-hidden className="size-3.5 text-muted-foreground" />
      <span className="flex-1">{page.trashedAt !== null ? "This page is in the trash." : "This page is inside a page in the trash."}</span>
      {editable && (
        <Button size="xs" variant="outline" onClick={() => restorePage(indexDoc, page.id)}>
          <RotateCcw /> Restore
        </Button>
      )}
    </div>
  );
}
