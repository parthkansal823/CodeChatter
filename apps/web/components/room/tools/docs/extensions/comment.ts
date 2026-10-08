import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Mark, mergeAttributes } from "@tiptap/react";

/** Raised on the editor's DOM when commented text is clicked; the detail is the thread id. */
export const COMMENT_EVENT = "cc-comment-open";

/**
 * Marks the text a comment thread is about. The mark lives in the page's own
 * content, so it follows the text as people edit; the thread itself (messages,
 * resolved) is in the page document's `comments` map.
 */
export const Comment = Mark.create({
  name: "comment",
  inclusive: false,
  // Two threads can cover the same words.
  excludes: "",

  addAttributes() {
    return {
      threadId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-thread"),
        renderHTML: (attributes) => (attributes.threadId ? { "data-thread": attributes.threadId } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-thread]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "cc-comment" }), 0];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("commentClick"),
        props: {
          handleDOMEvents: {
            click: (view, event) => {
              const thread = (event.target as HTMLElement | null)?.closest?.("[data-thread]")?.getAttribute("data-thread");
              if (!thread) return false;
              view.dom.dispatchEvent(new CustomEvent<string>(COMMENT_EVENT, { bubbles: true, detail: thread }));
              return false;
            },
          },
        },
      }),
    ];
  },
});
