"use client";

import { flatten, listTree, pathOf } from "@codechatter/workspace-model";
import { Collaboration, isChangeOrigin } from "@tiptap/extension-collaboration";
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret";
import { Placeholder } from "@tiptap/extensions";
import type { Transaction } from "@tiptap/pm/state";
import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Skeleton } from "@/components/ui/skeleton";

import { baseExtensions } from "./base-extensions";
import { asSlot, presenceUser, type Connection } from "./connection";
import { useDocs, type DocsContextValue } from "./docs-context";
import { useDocsStore } from "./docs-store";
import { COMMENT_EVENT } from "./extensions/comment";
import { SlashCommand } from "./extensions/slash-command";
import { TAG_EVENT } from "./extensions/tag-highlight";
import { WIKI_OPEN_EVENT, type WikiAttrs, type WikiItem } from "./extensions/wiki-link";
import { saveSnapshot, SNAPSHOT_EVERY_MS, shouldSnapshot } from "./history";
import { summarize } from "./links";
import { resolverFor, toMarkdown } from "./markdown";
import { allPages, ancestorsOf, createPage, isLive, recordEdit, syncSummary, titleOf } from "./pages-model";
import { writePublished } from "./publish";
import { pendingContent } from "./templates";
import "./docs.css";

/** A remote caret: a 2px bar in the person's presence hue with their name flag, like the code editor's. */
function renderCaret(user: Record<string, unknown>): HTMLElement {
  const slot = asSlot(user.slot);
  const caret = document.createElement("span");
  caret.className = "cc-doc-caret";
  caret.style.setProperty("--caret", `var(--p-${slot})`);
  caret.style.setProperty("--caret-soft", `var(--p-${slot}-soft)`);
  const label = document.createElement("span");
  label.className = "cc-doc-caret-label";
  label.textContent = (typeof user.name === "string" ? user.name : "Someone").slice(0, 24);
  caret.append(label);
  return caret;
}

const renderSelection = (user: Record<string, unknown>) => ({
  nodeName: "span",
  class: "cc-doc-selection",
  style: `--caret: var(--p-${asSlot(user.slot)})`,
});

const PUBLISH_DELAY_MS = 5_000;

type Props = {
  pageId: string;
  connection: Connection;
  onEditor: (editor: Editor | null) => void;
  /** Commented text was clicked. */
  onThread: (threadId: string) => void;
};

/**
 * One page's rich-text editor, bound to the page's Yjs document. Everything
 * the link picker needs is read from the live documents when it's asked for,
 * so the editor is built once per page.
 */
export function PageEditor({ pageId, connection, onEditor, onThread }: Props) {
  const docs = useDocs();
  const { doc, provider, synced } = connection;
  const { indexDoc, filesDoc, editable, me, roomId } = docs;
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  // The latest tool state for timers and listeners that outlive a render.
  const latest = useRef<DocsContextValue>(docs);
  useEffect(() => {
    latest.current = docs;
  });

  const editor = useEditor(
    {
      immediatelyRender: false,
      editable,
      extensions: [
        ...baseExtensions({
          search: (query) => searchTargets(docs, pageId, query),
          create: (title) => {
            if (!editable) return null;
            const id = createPage(indexDoc, { title, createdBy: me.id });
            return { kind: "page", target: id, path: null, label: title };
          },
          resolve: (text) => resolveTarget(docs, text),
        }),
        Placeholder.configure({ placeholder: ({ node }) => (node.type.name === "heading" ? "Heading" : "Type / for commands") }),
        SlashCommand.configure({
          createSubPage: () => {
            if (!editable) return null;
            const id = createPage(indexDoc, { parentId: pageId, createdBy: me.id });
            useDocsStore.getState().setExpanded(roomId, pageId, true);
            return { id, label: "" };
          },
        }),
        Collaboration.configure({ document: doc, field: "content" }),
        CollaborationCaret.configure({ provider, user: presenceUser(me), render: renderCaret, selectionRender: renderSelection }),
      ],
      editorProps: {
        attributes: { class: "cc-doc-content", "aria-label": "Page content" },
        // Links open with Ctrl or Cmd held, so a plain click can still place the caret in them.
        handleClick: (_view, _pos, event) => {
          const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]");
          if (!anchor || !(event.ctrlKey || event.metaKey)) return false;
          window.open(anchor.getAttribute("href") ?? "", "_blank", "noopener,noreferrer");
          return true;
        },
      },
    },
    [],
  );

  useEffect(() => {
    onEditor(editor);
    return () => onEditor(null);
  }, [editor, onEditor]);

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(editable);
  }, [editor, editable]);

  // Clicked [[links]], #tags and commented text raise DOM events from inside the editor.
  const { openPage, openFile, openTag } = docs;
  useEffect(() => {
    if (!host) return;
    const onWiki = (event: Event) => {
      const attrs = (event as CustomEvent<WikiAttrs>).detail;
      if (attrs.kind === "page") return openPage(attrs.target);
      const files = flatten(listTree(filesDoc));
      const file = files.find((f) => f.id === attrs.target) ?? files.find((f) => f.path === attrs.path);
      if (file) openFile(file.id);
      else toast.error("That file isn't in the room any more.");
    };
    const onTag = (event: Event) => openTag((event as CustomEvent<string>).detail);
    const onComment = (event: Event) => onThread((event as CustomEvent<string>).detail);
    host.addEventListener(WIKI_OPEN_EVENT, onWiki);
    host.addEventListener(TAG_EVENT, onTag);
    host.addEventListener(COMMENT_EVENT, onComment);
    return () => {
      host.removeEventListener(WIKI_OPEN_EVENT, onWiki);
      host.removeEventListener(TAG_EVENT, onTag);
      host.removeEventListener(COMMENT_EVENT, onComment);
    };
  }, [host, openPage, openFile, openTag, onThread, filesDoc]);

  // A page made from a template gets its content once its (empty) document has synced.
  useEffect(() => {
    if (!editor || !synced || !editable) return;
    const content = pendingContent.get(pageId);
    if (!content) return;
    pendingContent.delete(pageId);
    if (doc.getXmlFragment("content").length === 0) editor.commands.setContent(content);
  }, [editor, synced, editable, pageId, doc]);

  // What the content says about the room (links, tags, text) is written to the index when you stop typing,
  // and once the page loads in case someone left before theirs was saved. The first saved version, a
  // version every few minutes of editing, and the published copy follow the same edits.
  useEffect(() => {
    if (!editor || !synced || !editable) return;
    const summary = () =>
      summarize(editor.state.doc, {
        filePath: (id) => pathOf(filesDoc, id),
        pageTitle: (id) => {
          const page = latest.current.byId.get(id);
          return page ? titleOf(page) : null;
        },
      });
    const author = { id: me.id, name: me.name };
    const titleNow = () => {
      const page = latest.current.byId.get(pageId);
      return page ? page.title : "";
    };
    let content: JSONContent = editor.getJSON();
    let dirty = false;
    let lastAttempt = 0;
    let publishPending = false;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let publishTimer: ReturnType<typeof setTimeout> | undefined;

    const publish = async () => {
      publishTimer = undefined;
      publishPending = false;
      const page = latest.current.byId.get(pageId);
      if (!page?.publishToken) return;
      const markdown = toMarkdown(titleOf(page), content, resolverFor(latest.current));
      await writePublished(roomId, pageId, { title: titleOf(page), markdown, updatedAt: Date.now() }).catch(() => {});
    };
    const snapshot = (options: Parameters<typeof saveSnapshot>[3]) =>
      void saveSnapshot(roomId, pageId, { by: author, title: titleNow(), content }, options).catch(() => {});

    const flush = () => {
      flushTimer = undefined;
      if (editor.isDestroyed) return;
      content = editor.getJSON();
      dirty = true;
      recordEdit(indexDoc, pageId, summary());
      if (latest.current.byId.get(pageId)?.publishToken) {
        publishPending = true;
        clearTimeout(publishTimer);
        publishTimer = setTimeout(() => void publish(), PUBLISH_DELAY_MS);
      }
    };
    const onUpdate = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.docChanged || isChangeOrigin(transaction)) return;
      clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, 800);
    };

    const heal = setTimeout(() => {
      if (editor.isDestroyed) return;
      syncSummary(indexDoc, pageId, summary());
      // The version before anyone's edits, when the page has no versions yet.
      if (!editor.isEmpty) snapshot({ onlyIfEmpty: true });
    }, 300);
    const every = setInterval(() => {
      if (!shouldSnapshot({ now: Date.now(), lastAt: lastAttempt, dirty })) return;
      lastAttempt = Date.now();
      dirty = false;
      snapshot({ minGapMs: SNAPSHOT_EVERY_MS });
    }, 30_000);

    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
      clearTimeout(heal);
      clearInterval(every);
      if (flushTimer) {
        clearTimeout(flushTimer);
        if (!editor.isDestroyed) {
          content = editor.getJSON();
          dirty = true;
          recordEdit(indexDoc, pageId, summary());
          publishPending = Boolean(latest.current.byId.get(pageId)?.publishToken);
        }
      }
      if (publishPending) void publish();
      if (dirty) snapshot({ minGapMs: SNAPSHOT_EVERY_MS });
    };
  }, [editor, synced, editable, indexDoc, filesDoc, pageId, roomId, me.id, me.name]);

  if (!editor || !synced) {
    return (
      <div className="grid gap-2 py-2" aria-label="Loading page">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }
  return (
    <div ref={setHost}>
      <EditorContent editor={editor} />
    </div>
  );
}

/** Pages (recently edited first) and files matching what was typed after [[. */
function searchTargets(docs: DocsContextValue, pageId: string, query: string): WikiItem[] {
  const q = query.trim().toLowerCase();
  const pages = allPages(docs.indexDoc);
  const byId = new Map(pages.map((p) => [p.id, p]));
  const rank = (text: string) => (text.toLowerCase().startsWith(q) ? 0 : 1);
  const pageItems: WikiItem[] = pages
    .filter((p) => p.id !== pageId && isLive(p, byId) && titleOf(p).toLowerCase().includes(q))
    .sort((a, b) => rank(titleOf(a)) - rank(titleOf(b)) || b.updatedAt - a.updatedAt)
    .slice(0, 8)
    .map((p) => ({ type: "page", id: p.id, title: titleOf(p), icon: p.icon, hint: ancestorsOf(p.id, byId).map(titleOf).join(" / ") }));
  const fileItems: WikiItem[] = flatten(listTree(docs.filesDoc))
    .filter((f) => f.kind === "file" && f.path.toLowerCase().includes(q))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.path.length - b.path.length)
    .slice(0, q ? 6 : 4)
    .map((f) => ({ type: "file", id: f.id, path: f.path }));
  const exists = pages.some((p) => isLive(p, byId) && titleOf(p).toLowerCase() === q);
  const create: WikiItem[] = q && docs.editable && !exists ? [{ type: "create", title: query.trim() }] : [];
  return [...pageItems, ...fileItems, ...create];
}

/** [[text]] typed out in full: an existing page by title, a file by path or name, or else a new page. */
function resolveTarget(docs: DocsContextValue, text: string): WikiAttrs | null {
  if (!text) return null;
  const q = text.toLowerCase();
  const pages = allPages(docs.indexDoc);
  const byId = new Map(pages.map((p) => [p.id, p]));
  const page = pages.find((p) => isLive(p, byId) && titleOf(p).toLowerCase() === q);
  if (page) return { kind: "page", target: page.id, path: null, label: titleOf(page) };
  const files = flatten(listTree(docs.filesDoc)).filter((f) => f.kind === "file");
  const byName = files.filter((f) => f.name.toLowerCase() === q);
  const file = files.find((f) => f.path.toLowerCase() === q) ?? (byName.length === 1 ? byName[0] : undefined);
  if (file) return { kind: "file", target: file.id, path: file.path, label: file.path };
  if (!docs.editable) return null;
  const id = createPage(docs.indexDoc, { title: text, createdBy: docs.me.id });
  return { kind: "page", target: id, path: null, label: text };
}
