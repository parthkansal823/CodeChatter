import { PluginKey, Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Extension } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";

import { findTags } from "../tags";

/** Raised on the editor's DOM when a tag is opened (Ctrl or Cmd click, or any click in a read-only page). */
export const TAG_EVENT = "cc-tag-open";

function decorate(doc: PMNode): DecorationSet {
  const found: Decoration[] = [];
  doc.descendants((node, pos, parent) => {
    if (!node.isText || !node.text || parent?.type.name === "codeBlock" || node.marks.some((mark) => mark.type.name === "code")) return;
    for (const match of findTags(node.text)) {
      found.push(Decoration.inline(pos + match.index, pos + match.index + match.length, { class: "cc-tag", "data-tag": match.tag }));
    }
  });
  return DecorationSet.create(doc, found);
}

/** Styles #tags as you type. Tags live in the text, so there is nothing extra to sync. */
export const TagHighlight = Extension.create({
  name: "tagHighlight",
  addProseMirrorPlugins() {
    const key = new PluginKey<DecorationSet>("tagHighlight");
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_config, state) => decorate(state.doc),
          apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old),
        },
        props: {
          decorations: (state) => key.getState(state),
          handleDOMEvents: {
            click: (view, event) => {
              const tag = (event.target as HTMLElement | null)?.closest?.("[data-tag]")?.getAttribute("data-tag");
              if (!tag || !(event.ctrlKey || event.metaKey || !view.editable)) return false;
              view.dom.dispatchEvent(new CustomEvent<string>(TAG_EVENT, { bubbles: true, detail: tag }));
              return true;
            },
          },
        },
      }),
    ];
  },
});
