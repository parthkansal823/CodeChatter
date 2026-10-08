"use client";

import type { Editor } from "@tiptap/react";
import { History, MessageSquare, MoreHorizontal } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";

import { Backlinks } from "./backlinks";
import { createThread, useThreads } from "./comments";
import { CommentsPanel } from "./comments-panel";
import { usePageConnection } from "./connection";
import { useDocs } from "./docs-context";
import { DocsHeader } from "./docs-header";
import { saveSnapshot, type Snapshot } from "./history";
import { HistoryPanel, SnapshotPreview } from "./history-panel";
import { resolverFor, toMarkdown } from "./markdown";
import { unlinkedMentions } from "./mentions";
import { Breadcrumbs, PagePeers, PageTitle, TrashBanner } from "./page-chrome";
import { PageEditor } from "./page-editor";
import { DROPDOWN_KIT, PageActions } from "./page-menus";
import { titleOf, updatePage, type PageRecord } from "./pages-model";
import { SelectionMenu } from "./selection-menu";
import { SharePopover } from "./share-popover";

type Side = "comments" | "history" | null;

/** A document page: header, title, the live editor, backlinks, and the comments and history panels. */
export function DocumentPage({ page }: { page: PageRecord }) {
  const docs = useDocs();
  const { roomId, me, editable, indexDoc, isLive } = docs;
  const connection = usePageConnection(roomId, page.id);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [side, setSide] = useState<Side>(null);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Snapshot | null>(null);
  const article = useRef<HTMLElement>(null);
  const threads = useThreads(connection?.doc ?? null);
  const openThreads = threads.filter((thread) => !thread.resolved && thread.messages.length > 0).length;
  const author = { id: me.id, name: me.name };

  const showThread = useCallback((id: string) => {
    setActiveThread(id);
    setSide("comments");
  }, []);

  // The selection becomes a thread: the mark goes on the text, the thread opens for its first message.
  const comment = () => {
    if (!editor || !connection || editor.state.selection.empty) return;
    const { from, to } = editor.state.selection;
    const quote = editor.state.doc.textBetween(from, to, " ").slice(0, 280);
    const id = createThread(connection.doc, { quote, by: author });
    editor.chain().focus().setMark("comment", { threadId: id }).run();
    showThread(id);
  };

  const restore = (snapshot: Snapshot) => {
    if (!editor) return;
    // The page as it is now is kept as a version too, so a restore can be undone.
    void saveSnapshot(roomId, page.id, { by: author, title: page.title, content: editor.getJSON() }, { label: "Before restoring" }).catch(() => {});
    editor.commands.setContent(snapshot.content);
    updatePage(indexDoc, page.id, { title: snapshot.title });
    setViewing(null);
  };

  const closeSide = () => {
    setSide(null);
    setViewing(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DocsHeader
        actions={
          <>
            {connection && <PagePeers provider={connection.provider} />}
            <Button
              variant={side === "comments" ? "secondary" : "ghost"}
              size="xs"
              aria-label={openThreads ? `Comments, ${openThreads} open` : "Comments"}
              aria-pressed={side === "comments"}
              onClick={() => (side === "comments" ? closeSide() : setSide("comments"))}
            >
              <MessageSquare />
              {openThreads > 0 && <span className="tabular-nums">{openThreads}</span>}
            </Button>
            <Button
              variant={side === "history" ? "secondary" : "ghost"}
              size="icon-xs"
              aria-label="Version history"
              aria-pressed={side === "history"}
              onClick={() => (side === "history" ? closeSide() : (setViewing(null), setSide("history")))}
            >
              <History />
            </Button>
            <SharePopover page={page} markdown={() => (editor ? toMarkdown(titleOf(page), editor.getJSON(), resolverFor(docs)) : null)} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" aria-label="More page actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52" onCloseAutoFocus={(e) => e.preventDefault()}>
                <PageActions
                  kit={DROPDOWN_KIT}
                  page={page}
                  onRename={() => article.current?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Page title"]')?.focus()}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      >
        <Breadcrumbs page={page} />
      </DocsHeader>
      {!isLive(page.id) && <TrashBanner page={page} />}
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {viewing && (
            <div className="mx-auto w-full max-w-3xl px-10 py-8">
              <SnapshotPreview snapshot={viewing} />
            </div>
          )}
          {/* The editor stays mounted while a version is previewed, so nothing reloads when you go back. */}
          <article ref={article} hidden={Boolean(viewing)} className="mx-auto w-full max-w-3xl px-10 py-8">
            <PageTitle
              page={page}
              onEnter={() => {
                if (!editor) return;
                editor.commands.focus("start");
                // The command moves focus a frame later; without this, a fast typist's next key lands in the title.
                editor.view.focus();
              }}
            />
            {connection ? (
              <PageEditor pageId={page.id} connection={connection} onEditor={setEditor} onThread={showThread} />
            ) : (
              <div className="grid gap-2 py-2" aria-label="Loading page">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            )}
            <Backlinks pageId={page.id} />
            <UnlinkedMentions page={page} />
          </article>
        </div>
        {side === "comments" && connection && (
          <CommentsPanel doc={connection.doc} editor={editor} threads={threads} activeId={activeThread} onActive={setActiveThread} onClose={closeSide} />
        )}
        {side === "history" && (
          <HistoryPanel
            pageId={page.id}
            current={() => (editor ? { title: page.title, content: editor.getJSON() } : null)}
            viewing={viewing}
            onView={setViewing}
            onRestore={restore}
            onClose={closeSide}
          />
        )}
      </div>
      {editor && editable && !viewing && <SelectionMenu editor={editor} onComment={comment} />}
    </div>
  );
}

/** Pages that say this page's title in plain text without linking to it. */
function UnlinkedMentions({ page }: { page: PageRecord }) {
  const { live, openPage } = useDocs();
  const mentions = useMemo(() => unlinkedMentions(page, live), [page, live]);
  if (mentions.length === 0) return null;
  return (
    <section aria-labelledby="docs-unlinked" className="mt-6">
      <h2 id="docs-unlinked" className="text-xs font-medium text-muted-foreground">
        Mentioned without a link in {mentions.length} {mentions.length === 1 ? "page" : "pages"}
      </h2>
      <ul className="mt-1.5 grid gap-0.5">
        {mentions.map(({ page: other, snippet }) => (
          <li key={other.id}>
            <button type="button" onClick={() => openPage(other.id)} className="w-full rounded-md px-2 py-1 text-left hover:bg-accent">
              <span className="block truncate text-sm">{titleOf(other)}</span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{snippet}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
