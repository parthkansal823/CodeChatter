"use client";

import { isChangeOrigin } from "@tiptap/extension-collaboration";
import { NodeSelection, PluginKey } from "@tiptap/pm/state";
import { InputRule, mergeAttributes, Node, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { Suggestion } from "@tiptap/suggestion";
import { FileCode2, FilePlus2, FileText } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { cn } from "@/lib/utils";

import { useDocs } from "../docs-context";
import { titleOf } from "../pages-model";
import { renderSuggestion } from "./suggestion-menu";

/** A link to a page (target = page id) or a room file (target = file id, path kept as a fallback). */
export type WikiAttrs = { kind: "page" | "file"; target: string; path: string | null; label: string };

export type WikiItem =
  | { type: "page"; id: string; title: string; icon: string; hint: string }
  | { type: "file"; id: string; path: string }
  | { type: "create"; title: string };

export type WikiLinkOptions = {
  /** Pages and files matching what's typed after [[. */
  search: (query: string) => WikiItem[];
  /** Makes a page for a title that doesn't exist yet; null when you can't edit. */
  create: (title: string) => WikiAttrs | null;
  /** What a fully typed [[Title]] points at (an existing page or file, or a new page). */
  resolve: (text: string) => WikiAttrs | null;
};

/** Following a link is the host's job: the editor raises this DOM event and the page listens. */
export const WIKI_OPEN_EVENT = "cc-wikilink-open";

function follow(from: Element, attrs: WikiAttrs) {
  from.dispatchEvent(new CustomEvent<WikiAttrs>(WIKI_OPEN_EVENT, { bubbles: true, detail: attrs }));
}

const attrsOf = (item: WikiItem, create: WikiLinkOptions["create"]): WikiAttrs | null =>
  item.type === "page"
    ? { kind: "page", target: item.id, path: null, label: item.title }
    : item.type === "file"
      ? { kind: "file", target: item.id, path: item.path, label: item.path }
      : create(item.title);

export const WikiLink = Node.create<WikiLinkOptions>({
  name: "wikiLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { search: () => [], create: () => null, resolve: () => null };
  },

  addAttributes() {
    return {
      kind: { default: "page", parseHTML: (el) => (el.getAttribute("data-kind") === "file" ? "file" : "page") },
      target: { default: "", parseHTML: (el) => el.getAttribute("data-target") ?? "" },
      path: { default: null, parseHTML: (el) => el.getAttribute("data-path") },
      label: { default: "", parseHTML: (el) => el.textContent ?? "" },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-wiki-link]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const { kind, target, path, label } = node.attrs as WikiAttrs;
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-wiki-link": "", "data-kind": kind, "data-target": target, "data-path": path ?? undefined, class: "cc-wikilink" }),
      label,
    ];
  },

  renderText({ node }) {
    return `[[${(node.attrs as WikiAttrs).label}]]`;
  },

  addNodeView() {
    return ReactNodeViewRenderer(WikiLinkView, { as: "span" });
  },

  addKeyboardShortcuts() {
    return {
      // Enter on a selected link follows it, like clicking.
      Enter: ({ editor }) => {
        const { selection } = editor.state;
        if (!(selection instanceof NodeSelection) || selection.node.type.name !== this.name) return false;
        follow(editor.view.dom, selection.node.attrs as WikiAttrs);
        return true;
      },
    };
  },

  addInputRules() {
    return [
      // Typing the closing ]] turns [[Title]] into a link without using the picker.
      new InputRule({
        find: /\[\[([^[\]]+)\]\]$/,
        handler: ({ state, range, match }) => {
          const attrs = this.options.resolve((match[1] ?? "").trim());
          if (!attrs) return null;
          state.tr.replaceWith(range.from, range.to, this.type.create(attrs));
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    const { search, create } = this.options;
    return [
      Suggestion<WikiItem, WikiItem>({
        editor: this.editor,
        pluginKey: new PluginKey("wikiLink"),
        char: "[[",
        allowSpaces: true,
        allowedPrefixes: null,
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          return $from.parent.type.name !== "codeBlock" && !state.doc.textBetween(range.from, range.to).includes("]]");
        },
        shouldShow: ({ transaction }) => !isChangeOrigin(transaction),
        items: ({ query }) => search(query),
        command: ({ editor, range, props }) => {
          const attrs = attrsOf(props, create);
          if (!attrs) return;
          // A space after the link, unless one is already there.
          const next = editor.state.doc.textBetween(range.to, Math.min(range.to + 1, editor.state.doc.content.size));
          editor
            .chain()
            .focus()
            .insertContentAt(range, [{ type: this.name, attrs }, ...(next === " " ? [] : [{ type: "text", text: " " }])])
            .run();
        },
        render: renderSuggestion<WikiItem>({
          label: "Link to a page or file",
          empty: "Type to search pages and files",
          describe: (item) =>
            item.type === "page"
              ? { key: `p:${item.id}`, label: item.title, hint: item.hint, section: "Pages", icon: item.icon ? <span className="text-sm">{item.icon}</span> : <FileText /> }
              : item.type === "file"
                ? { key: `f:${item.id}`, label: item.path.split("/").pop() ?? item.path, hint: item.path, section: "Files", icon: <FileCode2 /> }
                : { key: "create", label: `Create page "${item.title}"`, section: "New", icon: <FilePlus2 /> },
        }),
      }),
    ];
  },
});

/** Shows the page's current title (renames follow the link) or the file's current path. */
function WikiLinkView({ node }: ReactNodeViewProps) {
  const docs = useDocs();
  const attrs = node.attrs as WikiAttrs;
  const open = (event: ReactMouseEvent<HTMLElement>) => follow(event.currentTarget, attrs);

  if (attrs.kind === "file") {
    const file = docs.files.find((f) => f.id === attrs.target) ?? docs.files.find((f) => f.path === attrs.path);
    const shown = file?.path ?? attrs.path ?? attrs.label;
    return (
      <NodeViewWrapper
        as="span"
        role="link"
        data-kind="file"
        title={file ? `Open ${shown}` : "This file isn't in the room any more"}
        className={cn("cc-wikilink", !file && "is-missing")}
        onClick={open}
      >
        <FileCode2 aria-hidden className="cc-wikilink-icon" />
        <span className="font-mono text-[0.9em]">{shown}</span>
      </NodeViewWrapper>
    );
  }

  const page = docs.byId.get(attrs.target);
  const alive = page ? docs.isLive(page.id) : false;
  return (
    <NodeViewWrapper
      as="span"
      role="link"
      data-kind="page"
      title={!page ? "This page was deleted" : alive ? `Open ${titleOf(page)}` : "This page is in the trash"}
      className={cn("cc-wikilink", !alive && "is-missing")}
      onClick={open}
    >
      {page?.icon ? <span aria-hidden>{page.icon}</span> : <FileText aria-hidden className="cc-wikilink-icon" />}
      <span>{page ? titleOf(page) : attrs.label || "Deleted page"}</span>
    </NodeViewWrapper>
  );
}
