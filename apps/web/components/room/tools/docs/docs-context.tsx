"use client";

import type { TreeNode } from "@codechatter/workspace-model";
import { createContext, useContext } from "react";
import type * as Y from "yjs";

import type { PresenceSlot } from "@/components/presence/presence";
import type { Me } from "@/lib/me";

import type { PageRecord } from "./pages-model";
import type { TemplateId } from "./templates";

export type NewPageInput = { parentId?: string | null; template?: TemplateId; title?: string; open?: boolean };

/** Everything the docs tool's parts share: the live index, the room's files and the actions. */
export type DocsContextValue = {
  roomId: string;
  me: Me["user"];
  editable: boolean;
  indexDoc: Y.Doc;
  filesDoc: Y.Doc;
  /** Every page in the index, trashed ones included. */
  pages: PageRecord[];
  byId: Map<string, PageRecord>;
  /** Pages not in the trash (nor under a trashed page). */
  live: PageRecord[];
  isLive: (id: string) => boolean;
  /** The room's files, flattened (files only). */
  files: TreeNode[];
  currentId: string | null;
  view: "page" | "graph";
  /** Whose presence threads to draw next to a page. */
  slotsOn: (pageId: string) => PresenceSlot[];
  openPage: (id: string) => void;
  /** Open (or, if you can edit, create) the daily note for a "YYYY-MM-DD" date. */
  openDay: (date: string) => void;
  /** Filter the page list by a #tag. */
  openTag: (tag: string) => void;
  activeTag: string | null;
  openFile: (fileId: string) => void;
  newPage: (input?: NewPageInput) => string | null;
  openDaily: () => void;
  setView: (view: "page" | "graph") => void;
  openSwitcher: () => void;
  close: () => void;
  /** The page whose title should take focus once it renders (a page just created). */
  focusTitle: string | null;
  clearFocusTitle: () => void;
  sidebar: boolean;
  toggleSidebar: () => void;
};

const DocsContext = createContext<DocsContextValue | null>(null);

export const DocsProvider = DocsContext;

export function useDocs(): DocsContextValue {
  const value = useContext(DocsContext);
  if (!value) throw new Error("useDocs must be used inside the docs tool");
  return value;
}
