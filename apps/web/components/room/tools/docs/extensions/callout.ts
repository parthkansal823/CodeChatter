import { mergeAttributes, Node } from "@tiptap/react";

export type CalloutKind = "note" | "warning";

/** A boxed block for notes and warnings. It holds other blocks, so lists and code fit inside. */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      kind: {
        default: "note" satisfies CalloutKind,
        parseHTML: (element) => (element.getAttribute("data-kind") === "warning" ? "warning" : "note"),
        renderHTML: (attributes) => ({ "data-kind": attributes.kind === "warning" ? "warning" : "note" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-callout": "", class: "cc-callout" }), 0];
  },
});
