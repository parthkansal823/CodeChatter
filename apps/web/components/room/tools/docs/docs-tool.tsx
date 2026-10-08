"use client";

import { flatten } from "@codechatter/workspace-model";
import { CalendarDays, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

import { useFileTree } from "@/components/room/hooks";
import { useRoom } from "@/components/room/room-context";
import type { RoomToolProps } from "@/components/room/tools/registry";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { useAwarenessPeers, useDocsConnection, usePages, type Connection } from "./connection";
import { DocsProvider, useDocs, type DocsContextValue, type NewPageInput } from "./docs-context";
import { DocsHeader } from "./docs-header";
import { useDocsStore, useRoomDocsState } from "./docs-store";
import { GraphView } from "./graph-view";
import { NewPageMenu } from "./page-menus";
import { PageSidebar } from "./page-sidebar";
import { PageView } from "./page-view";
import { ancestorsOf, createPage, dailyId, isLive, localDate, restorePage } from "./pages-model";
import { QuickSwitcher } from "./quick-switcher";
import { pendingContent, templateById } from "./templates";

/** Docs and notes for the room: a live page tree, pages edited together, links, backlinks and a graph. */
export default function DocsTool({ openFile, close }: RoomToolProps) {
  const { room, me } = useRoom();
  const connection = useDocsConnection(room.id, me.user);

  if (!connection?.synced) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-9 shrink-0 items-center border-b bg-chrome px-3">
          <span className="text-sm font-medium">Docs</span>
          <Button variant="ghost" size="icon-xs" aria-label="Close docs" className="ml-auto" onClick={close}>
            <X />
          </Button>
        </div>
        <div className="grid gap-2 p-6" aria-label="Loading docs">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    );
  }
  return <DocsWorkspace connection={connection} openFile={openFile} close={close} />;
}

function DocsWorkspace({ connection, openFile, close }: { connection: Connection } & Pick<RoomToolProps, "openFile" | "close">) {
  const { room, me, can, doc: filesDoc } = useRoom();
  const indexDoc = connection.doc;
  const pages = usePages(indexDoc);
  const tree = useFileTree();
  const files = useMemo(() => flatten(tree).filter((node) => node.kind === "file"), [tree]);
  const byId = useMemo(() => new Map(pages.map((page) => [page.id, page])), [pages]);
  const live = useMemo(() => pages.filter((page) => isLive(page, byId)), [pages, byId]);
  const peers = useAwarenessPeers(connection.provider);
  const { current } = useRoomDocsState(room.id);
  const setCurrent = useDocsStore((state) => state.setCurrent);
  const setExpanded = useDocsStore((state) => state.setExpanded);
  const [view, setView] = useState<"page" | "graph">("page");
  const [focusTitle, setFocusTitle] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState(true);
  const [switcher, setSwitcher] = useState(false);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const editable = can("files.edit");

  // The page you picked while it exists (even in the trash), else the most recently edited one.
  const currentPage = (current ? byId.get(current) : undefined) ?? [...live].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;

  // Others see a presence thread on the page you're reading.
  const onPage = view === "page" ? (currentPage?.id ?? null) : null;
  useEffect(() => {
    connection.provider.setAwarenessField("pageId", onPage);
  }, [connection.provider, onPage]);

  const openPage = (id: string) => {
    setCurrent(room.id, id);
    setView("page");
    for (const parent of ancestorsOf(id, byId)) setExpanded(room.id, parent.id, true);
  };

  const newPage = ({ parentId = null, template = "empty", title, open = true }: NewPageInput = {}) => {
    if (!editable) return null;
    const chosen = templateById(template);
    const date = localDate();
    const id = createPage(indexDoc, { title: title ?? chosen.title(date), parentId, createdBy: me.user.id });
    const content = chosen.content(date);
    if (content) pendingContent.set(id, content);
    if (parentId) setExpanded(room.id, parentId, true);
    if (open) {
      openPage(id);
      setFocusTitle(id);
    }
    return id;
  };

  const openDay = (date: string) => {
    const id = dailyId(date);
    const existing = byId.get(id);
    if (!existing) {
      if (!editable) return;
      createPage(indexDoc, { id, title: date, kind: "daily", createdBy: me.user.id });
    } else if (!isLive(existing, byId) && editable) restorePage(indexDoc, id);
    openPage(id);
  };

  // A tag clicked in a page filters the page list; clicking the same tag again clears it.
  const openTag = (tag: string) => {
    setActiveTag((current) => (current === tag ? null : tag));
    setSidebar(true);
  };

  const value: DocsContextValue = {
    roomId: room.id,
    me: me.user,
    editable,
    indexDoc,
    filesDoc,
    pages,
    byId,
    live,
    isLive: (id) => {
      const page = byId.get(id);
      return page ? isLive(page, byId) : false;
    },
    files,
    currentId: currentPage?.id ?? null,
    view,
    slotsOn: (pageId) => peers.filter((peer) => peer.pageId === pageId).map((peer) => peer.user.slot),
    openPage,
    openDay,
    openTag,
    activeTag,
    openFile,
    newPage,
    openDaily: () => openDay(localDate()),
    setView,
    openSwitcher: () => setSwitcher(true),
    close,
    focusTitle,
    clearFocusTitle: () => setFocusTitle(null),
    sidebar,
    toggleSidebar: () => setSidebar((open) => !open),
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      event.stopPropagation();
      setSwitcher(true);
    }
  };

  return (
    <DocsProvider value={value}>
      <div className="flex h-full min-h-0 bg-background" onKeyDownCapture={onKeyDown}>
        {sidebar && <PageSidebar />}
        <main aria-label="Docs" className="flex min-w-0 flex-1 flex-col">
          {view === "graph" ? <GraphView /> : currentPage ? <PageView key={currentPage.id} page={currentPage} /> : <EmptyState />}
        </main>
      </div>
      <QuickSwitcher open={switcher} onOpenChange={setSwitcher} />
    </DocsProvider>
  );
}

function EmptyState() {
  const { editable, openDaily } = useDocs();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <DocsHeader />
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <div className="max-w-sm">
          <p className="font-medium">No pages yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {editable
              ? "Keep specs, meeting notes and runbooks next to the code. Everyone in the room edits pages together, live."
              : "Pages that people with edit access create will show up here."}
          </p>
          {editable && (
            <div className="mt-4 flex justify-center gap-2">
              <NewPageMenu>
                <Button size="sm">
                  <Plus /> New page
                </Button>
              </NewPageMenu>
              <Button size="sm" variant="outline" onClick={openDaily}>
                <CalendarDays /> Today&apos;s note
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
