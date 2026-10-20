"use client";

import type { TreeNode } from "@codechatter/workspace-model";
import { ChevronRight, FileCode, Folder } from "lucide-react";
import { useMemo } from "react";

import { useFileTree } from "@/components/room/hooks";
import type { monaco } from "@/components/room/monaco-setup";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { kindLabel, SymbolIcon } from "./symbol-icon";
import { siblingsOf, symbolsAt, type SymbolItem } from "./symbols";
import { revealSymbol, useOutline } from "./use-outline";

type Editor = monaco.editor.IStandaloneCodeEditor;

type Props = {
  editor: Editor | null;
  file: TreeNode;
  /** Open another file in this pane. */
  onOpen: (id: string) => void;
};

/**
 * Above the code, as in VS Code: the file's folders, the file, then the symbols the
 * cursor is in. Each opens a menu: a folder's files, the file's whole outline, or the
 * symbols beside one.
 */
export function Breadcrumbs({ editor, file, onOpen }: Props) {
  const { symbols, supported, offset } = useOutline(editor);
  const tree = useFileTree();
  const folders = useMemo(() => {
    const out: TreeNode[] = [];
    let level = tree;
    for (const name of file.path.split("/").slice(0, -1)) {
      const folder = level.find((n) => n.kind === "folder" && n.name === name);
      if (!folder) break;
      out.push(folder);
      level = folder.children;
    }
    return out;
  }, [tree, file.path]);
  const chain = symbols && offset !== null ? symbolsAt(symbols, offset) : [];
  const reveal = (symbol: SymbolItem) => editor && revealSymbol(editor, symbol);
  // When a menu closes, focus goes back to the code, not to the crumb (the menu holds focus
  // while it's open, so focusing the editor from a pick alone wouldn't stick).
  const keepEditorFocus = (event: Event) => {
    event.preventDefault();
    editor?.focus();
  };

  return (
    <nav
      aria-label="Breadcrumbs"
      className="flex h-6 shrink-0 items-center overflow-x-auto overflow-y-hidden border-b bg-background px-2 text-xs whitespace-nowrap text-muted-foreground [scrollbar-width:none]"
    >
      <ol className="flex items-center">
        {folders.map((folder) => (
          <li key={folder.id} className="flex items-center">
            <DropdownMenu>
              <Crumb label={`Folder ${folder.name}`}>
                <Folder className="size-3.5" aria-hidden /> {folder.name}
              </Crumb>
              <DropdownMenuContent align="start" onCloseAutoFocus={keepEditorFocus} className="max-h-80 min-w-48 overflow-y-auto">
                <FolderItems nodes={folder.children} current={file.id} onOpen={onOpen} />
              </DropdownMenuContent>
            </DropdownMenu>
            <Separator />
          </li>
        ))}
        <li className="flex items-center">
          <DropdownMenu>
            <Crumb label={`Outline of ${file.name}`} current={chain.length === 0}>
              <FileCode className="size-3.5" aria-hidden /> {file.name}
            </Crumb>
            <DropdownMenuContent align="start" onCloseAutoFocus={keepEditorFocus} className="max-h-80 min-w-56 overflow-y-auto">
              {!supported ? (
                <DropdownMenuLabel className="font-normal text-muted-foreground">No outline for this language yet.</DropdownMenuLabel>
              ) : !symbols?.length ? (
                <DropdownMenuLabel className="font-normal text-muted-foreground">{symbols ? "No symbols in this file." : "Reading the file…"}</DropdownMenuLabel>
              ) : (
                symbols.map((symbol, i) => (
                  <SymbolMenuItem key={`${symbol.start}-${i}`} symbol={symbol} indent current={chain.includes(symbol)} onSelect={() => reveal(symbol)} />
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </li>
        {symbols &&
          chain.map((symbol, i) => (
            <li key={`${symbol.start}-${i}`} className="flex items-center">
              <Separator />
              <DropdownMenu>
                <Crumb label={`${kindLabel(symbol.kind)} ${symbol.name}`} current={i === chain.length - 1}>
                  <SymbolIcon kind={symbol.kind} /> {symbol.name}
                </Crumb>
                <DropdownMenuContent align="start" onCloseAutoFocus={keepEditorFocus} className="max-h-80 min-w-48 overflow-y-auto">
                  {siblingsOf(symbols, symbol).map((sibling, j) => (
                    <SymbolMenuItem key={`${sibling.start}-${j}`} symbol={sibling} current={sibling === symbol} onSelect={() => reveal(sibling)} />
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
      </ol>
    </nav>
  );
}

function Crumb({ label, current, children }: { label: string; current?: boolean; children: React.ReactNode }) {
  return (
    <DropdownMenuTrigger
      aria-label={label}
      aria-current={current ? "location" : undefined}
      className={cn(
        "flex h-5 items-center gap-1 rounded-sm px-1 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-accent data-[state=open]:text-foreground",
        current && "text-foreground",
      )}
    >
      {children}
    </DropdownMenuTrigger>
  );
}

const Separator = () => <ChevronRight aria-hidden className="size-3 shrink-0 opacity-60" />;


function SymbolMenuItem({ symbol, current, indent, onSelect }: { symbol: SymbolItem; current: boolean; indent?: boolean; onSelect: () => void }) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      aria-current={current ? "location" : undefined}
      className={cn("gap-1.5 py-1 text-xs", current && "bg-accent/60 font-medium")}
      style={indent ? { paddingLeft: 8 + symbol.depth * 12 } : undefined}
    >
      <SymbolIcon kind={symbol.kind} />
      <span className="truncate">{symbol.name}</span>
      <span className="ml-auto pl-3 text-2xs text-muted-foreground">{kindLabel(symbol.kind)}</span>
    </DropdownMenuItem>
  );
}

/** A folder's contents: subfolders open to the side, files open in the pane. */
function FolderItems({ nodes, current, onOpen }: { nodes: TreeNode[]; current: string; onOpen: (id: string) => void }) {
  const folders = nodes.filter((n) => n.kind === "folder");
  const files = nodes.filter((n) => n.kind === "file");
  if (!nodes.length) return <DropdownMenuLabel className="font-normal text-muted-foreground">Empty folder.</DropdownMenuLabel>;
  return (
    <>
      {folders.map((folder) => (
        <DropdownMenuSub key={folder.id}>
          <DropdownMenuSubTrigger className="gap-1.5 py-1 text-xs">
            <Folder className="size-3.5 text-muted-foreground" aria-hidden /> {folder.name}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 min-w-48 overflow-y-auto">
            <FolderItems nodes={folder.children} current={current} onOpen={onOpen} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ))}
      {files.map((node) => (
        <DropdownMenuItem
          key={node.id}
          onSelect={() => onOpen(node.id)}
          aria-current={node.id === current ? "page" : undefined}
          className={cn("gap-1.5 py-1 text-xs", node.id === current && "bg-accent/60 font-medium")}
        >
          <FileCode className="size-3.5 text-muted-foreground" aria-hidden /> {node.name}
        </DropdownMenuItem>
      ))}
    </>
  );
}
