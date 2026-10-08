import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import type { Extensions } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import { Callout } from "./extensions/callout";
import { Comment } from "./extensions/comment";
import { TagHighlight } from "./extensions/tag-highlight";
import { WikiLink, type WikiLinkOptions } from "./extensions/wiki-link";

/**
 * The page schema, shared by the live editor, read-only previews (history) and
 * the headless readers and writers (import, export). Undo comes from the
 * collaboration extension in the live editor, so StarterKit's is off.
 */
export function baseExtensions(wikiLink: Partial<WikiLinkOptions> = {}): Extensions {
  return [
    StarterKit.configure({
      undoRedo: false,
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Callout,
    Comment,
    TagHighlight,
    WikiLink.configure(wikiLink),
  ];
}
