"use client";

import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import { downloadPng, downloadSvg, exportIds, fileName } from "./export-actions";
import { useAtom, useEditor } from "./hooks";

/** Download the selection, or the whole canvas when nothing is selected. */
export function ExportMenu({ name }: { name: string }) {
  const editor = useEditor();
  const selection = useAtom(editor.selection);
  const target = selection.length ? "selection" : "everything";
  const file = () => {
    const [first] = exportIds(editor);
    const shape = selection.length === 1 && first ? editor.get(first) : undefined;
    return fileName(name, shape?.name ?? "");
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Download /> Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Exports the {target}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => downloadSvg(editor, file())}>Export SVG</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void downloadPng(editor, file(), 1)}>Export PNG at 1x</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void downloadPng(editor, file(), 2)}>Export PNG at 2x</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void downloadPng(editor, file(), 4)}>Export PNG at 4x</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
