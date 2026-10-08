"use client";

import { isChangeOrigin } from "@tiptap/extension-collaboration";
import { PluginKey } from "@tiptap/pm/state";
import { Extension, type Editor, type Range } from "@tiptap/react";
import { Suggestion } from "@tiptap/suggestion";
import {
  Code2,
  FilePlus2,
  Heading1,
  Heading2,
  Heading3,
  Info,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Table2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { renderSuggestion } from "./suggestion-menu";

export type SlashItem = {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  keywords: string;
  run: (editor: Editor, range: Range) => void;
};

type SlashOptions = {
  /** Creates a child of the open page and returns the link attributes, or null when not allowed. */
  createSubPage: () => { id: string; label: string } | null;
};

const block = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);

const BASE_ITEMS: SlashItem[] = [
  { id: "text", label: "Text", hint: "Plain paragraph", icon: Pilcrow, keywords: "paragraph p", run: (e, r) => block(e, r).setParagraph().run() },
  { id: "h1", label: "Heading 1", hint: "Large section heading", icon: Heading1, keywords: "title h1 #", run: (e, r) => block(e, r).setNode("heading", { level: 1 }).run() },
  { id: "h2", label: "Heading 2", hint: "Medium section heading", icon: Heading2, keywords: "subtitle h2 ##", run: (e, r) => block(e, r).setNode("heading", { level: 2 }).run() },
  { id: "h3", label: "Heading 3", hint: "Small section heading", icon: Heading3, keywords: "h3 ###", run: (e, r) => block(e, r).setNode("heading", { level: 3 }).run() },
  { id: "bullets", label: "Bulleted list", hint: "A simple list", icon: List, keywords: "ul unordered -", run: (e, r) => block(e, r).toggleBulletList().run() },
  { id: "numbers", label: "Numbered list", hint: "A list with numbers", icon: ListOrdered, keywords: "ol ordered 1.", run: (e, r) => block(e, r).toggleOrderedList().run() },
  { id: "todo", label: "To-do list", hint: "Track tasks with checkboxes", icon: ListChecks, keywords: "task checkbox check todo [ ]", run: (e, r) => block(e, r).toggleTaskList().run() },
  { id: "quote", label: "Quote", hint: "Quoted text", icon: Quote, keywords: "blockquote >", run: (e, r) => block(e, r).toggleBlockquote().run() },
  { id: "code", label: "Code block", hint: "Code with monospace text", icon: Code2, keywords: "snippet pre ```", run: (e, r) => block(e, r).toggleCodeBlock().run() },
  { id: "callout", label: "Callout", hint: "Make a note stand out", icon: Info, keywords: "note info box", run: (e, r) => block(e, r).wrapIn("callout", { kind: "note" }).run() },
  { id: "warning", label: "Warning", hint: "A callout for risks", icon: TriangleAlert, keywords: "caution danger callout", run: (e, r) => block(e, r).wrapIn("callout", { kind: "warning" }).run() },
  { id: "table", label: "Table", hint: "Rows and columns", icon: Table2, keywords: "grid", run: (e, r) => block(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: "divider", label: "Divider", hint: "A horizontal line", icon: Minus, keywords: "hr rule separator ---", run: (e, r) => block(e, r).setHorizontalRule().run() },
  // Typing [[ opens the link picker, so this item just types it.
  { id: "link", label: "Link to page or file", hint: "Pick a page or a file in this room", icon: Link2, keywords: "wiki mention [[ reference", run: (e, r) => block(e, r).insertContent("[[").run() },
];

function filter(items: SlashItem[], query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const hits = items.filter((item) => `${item.label} ${item.keywords}`.toLowerCase().includes(q));
  // Items whose name starts with the query come first.
  return hits.sort((a, b) => Number(!a.label.toLowerCase().startsWith(q)) - Number(!b.label.toLowerCase().startsWith(q)));
}

export const SlashCommand = Extension.create<SlashOptions>({
  name: "slashCommand",

  addOptions() {
    return { createSubPage: () => null };
  },

  addProseMirrorPlugins() {
    const { createSubPage } = this.options;
    const subPage: SlashItem = {
      id: "subpage",
      label: "Sub-page",
      hint: "Create a page inside this one and link it",
      icon: FilePlus2,
      keywords: "page new child nested",
      run: (editor, range) => {
        const page = createSubPage();
        if (!page) return;
        block(editor, range)
          .insertContent([{ type: "wikiLink", attrs: { kind: "page", target: page.id, label: page.label } }, { type: "text", text: " " }])
          .run();
      },
    };
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: new PluginKey("slashCommand"),
        char: "/",
        // Not inside code, where a slash is just a slash.
        allow: ({ state, range }) => state.doc.resolve(range.from).parent.type.name !== "codeBlock",
        shouldShow: ({ transaction }) => !isChangeOrigin(transaction),
        items: ({ query }) => filter([...BASE_ITEMS, subPage], query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: renderSuggestion<SlashItem>({
          label: "Insert a block",
          empty: "No matching blocks",
          describe: (item) => ({ key: item.id, label: item.label, hint: item.hint, icon: <item.icon /> }),
        }),
      }),
    ];
  },
});
