"use client";

import { ArrowUpToLine, FilePlus2, Pencil, Star, StarOff, Trash2 } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useDocs } from "./docs-context";
import { useDocsStore, useRoomDocsState } from "./docs-store";
import { movePage, trashPage, type PageRecord } from "./pages-model";
import { TEMPLATES } from "./templates";

/** The same menu renders as a dropdown (the row's "…" button) or a right-click menu. */
type MenuKit = {
  Item: typeof DropdownMenuItem | typeof ContextMenuItem;
  Separator: typeof DropdownMenuSeparator | typeof ContextMenuSeparator;
  Sub: typeof DropdownMenuSub | typeof ContextMenuSub;
  SubTrigger: typeof DropdownMenuSubTrigger | typeof ContextMenuSubTrigger;
  SubContent: typeof DropdownMenuSubContent | typeof ContextMenuSubContent;
};

export const DROPDOWN_KIT: MenuKit = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};

export const CONTEXT_KIT: MenuKit = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};

/** Empty page first, then the templates. */
export function TemplateItems({ kit, parentId }: { kit: MenuKit; parentId: string | null }) {
  const { newPage } = useDocs();
  return TEMPLATES.map((template, index) => (
    <Fragment key={template.id}>
      {index === 1 && <kit.Separator />}
      <kit.Item onSelect={() => newPage({ parentId, template: template.id })} className="items-start">
        <template.icon className="mt-0.5" />
        <span className="grid">
          <span>{template.label}</span>
          <span className="text-xs text-muted-foreground">{template.hint}</span>
        </span>
      </kit.Item>
    </Fragment>
  ));
}

/** "New page" as a dropdown of templates around any trigger. */
export function NewPageMenu({ parentId = null, align = "start", children }: { parentId?: string | null; align?: "start" | "end"; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-64" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{parentId ? "New page inside" : "New page"}</DropdownMenuLabel>
        <TemplateItems kit={DROPDOWN_KIT} parentId={parentId} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Actions on one page in the tree. */
export function PageActions({ kit, page, onRename }: { kit: MenuKit; page: PageRecord; onRename: () => void }) {
  const { roomId, indexDoc, editable, byId } = useDocs();
  const { favourites } = useRoomDocsState(roomId);
  const toggleFavourite = useDocsStore((state) => state.toggleFavourite);
  const favourite = favourites.includes(page.id);
  const nested = Boolean(page.parentId && byId.has(page.parentId));

  return (
    <>
      <kit.Item onSelect={() => toggleFavourite(roomId, page.id)}>
        {favourite ? <StarOff /> : <Star />} {favourite ? "Remove from favourites" : "Add to favourites"}
      </kit.Item>
      {editable && (
        <>
          <kit.Separator />
          <kit.Sub>
            <kit.SubTrigger>
              <FilePlus2 /> New page inside
            </kit.SubTrigger>
            <kit.SubContent className="w-64">
              <TemplateItems kit={kit} parentId={page.id} />
            </kit.SubContent>
          </kit.Sub>
          <kit.Item onSelect={onRename}>
            <Pencil /> Rename
          </kit.Item>
          {nested && (
            <kit.Item onSelect={() => movePage(indexDoc, page.id, null)}>
              <ArrowUpToLine /> Move to top level
            </kit.Item>
          )}
          <kit.Separator />
          <kit.Item variant="destructive" onSelect={() => trashPage(indexDoc, page.id)}>
            <Trash2 /> Move to trash
          </kit.Item>
        </>
      )}
    </>
  );
}
