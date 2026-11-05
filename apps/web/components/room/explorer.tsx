"use client";

import { blobView } from "@codechatter/contracts";
import {
  createFile,
  createFolder,
  move,
  pathOf,
  rename,
  trash,
  validateName,
  type TreeNode,
} from "@codechatter/workspace-model";
import {
  ChevronRight,
  Download,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileImage,
  FilePlus2,
  FileText,
  FileType,
  FileVideo,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderUp,
  MoreHorizontal,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import type * as Y from "yjs";

import { Threads, type PresenceSlot } from "@/components/presence/presence";
import { downloadZip, importSummary, planImport, readUpload, uploadBinaries } from "@/components/room/files-transfer";
import { requestCheckpoint } from "@/components/room/history/checkpoints";
import { useFileTree, usePeers } from "@/components/room/hooks";
import { useRoom } from "@/components/room/room-context";
import { roomContents, writeBlobs, writeFiles } from "@/components/room/source-control/room-files";
import { safeName } from "@/components/room/tools/docs/zip";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ZipError } from "@/lib/zip";

type Draft = { kind: "file" | "folder"; parentId: string | null } | null;

/** Everything a row needs from the explorer, passed down instead of closed over. */
type TreeCtx = {
  doc: Y.Doc;
  editable: boolean;
  activeFileId: string | null;
  expanded: Set<string>;
  draft: Draft;
  renaming: string | null;
  dropTarget: string | "root" | null;
  threadsFor: (id: string) => PresenceSlot[];
  toggle: (id: string) => void;
  open: (node: TreeNode) => void;
  setDraft: (draft: Draft) => void;
  setRenaming: (id: string | null) => void;
  setDropTarget: (id: string | "root" | null) => void;
  commitDraft: (name: string | null) => void;
  commitRename: (id: string, name: string | null) => void;
  drop: (event: DragEvent, folderId: string | null) => void;
};

export function Explorer({ activeFileId, onOpen }: { activeFileId: string | null; onOpen: (node: TreeNode) => void }) {
  const { doc, me, can, provider, room } = useRoom();
  const tree = useFileTree();
  const pickFiles = useRef<HTMLInputElement>(null);
  const pickFolder = useRef<HTMLInputElement>(null);
  const pickZip = useRef<HTMLInputElement>(null);
  const peers = usePeers();
  const editable = can("files.edit");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(tree.filter((n) => n.kind === "folder").map((n) => n.id)));
  const [draft, setDraft] = useState<Draft>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | "root" | null>(null);

  const expand = (id: string) => setExpanded((s) => new Set(s).add(id));

  /**
   * Files or a zip from your computer into the room (into a folder when dropped on one).
   * A checkpoint comes first, so History can put the room back as it was.
   */
  async function importUpload(files: File[], folderId: string | null) {
    if (!editable || !files.length) return;
    const label = files.length === 1 ? files[0]!.name : `${files.length} files`;
    const id = toast.loading(`Reading ${label}…`);
    try {
      const read = await readUpload(files);
      const into = folderId ? (pathOf(doc, folderId) ?? "") : "";
      const plan = planImport(read.entries, { into, existing: new Set(roomContents(doc).keys()), fromZip: read.fromZip });
      plan.skipped.unshift(...read.skipped);
      const nothing = () => {
        const first = plan.skipped[0];
        toast.error(first ? `Nothing to import: ${first.path} was skipped, because ${first.reason}.` : "Nothing to import.", { id });
      };
      if (!plan.files.size && !plan.binaries.size) return nothing();
      // Binary files' bytes go up first; the file tree only changes once they're stored.
      if (plan.binaries.size) toast.loading(`Uploading ${plan.binaries.size === 1 ? "1 file" : `${plan.binaries.size} files`}…`, { id });
      const blobs = await uploadBinaries(room.id, plan, (done, total) => toast.loading(`Uploading ${done} of ${total}…`, { id }));
      if (!plan.files.size && !blobs.size) return nothing();
      await requestCheckpoint(provider, "import", `Before importing ${label}`.slice(0, 100)).catch(() => {});
      doc.transact(() => {
        writeFiles(doc, plan.files, me.user.id, "import");
        writeBlobs(doc, blobs, me.user.id, "import");
      }, "import");
      if (folderId) expand(folderId);
      toast.success(importSummary(plan), { id, duration: 8_000 });
    } catch (error) {
      toast.error(error instanceof ZipError ? error.message : "Couldn't import that. Try again.", { id });
    }
  }
  const picked = (input: HTMLInputElement | null) => {
    const files = [...(input?.files ?? [])];
    if (input) input.value = "";
    void importUpload(files, null);
  };

  const ctx: TreeCtx = {
    doc,
    editable,
    activeFileId,
    expanded,
    draft,
    renaming,
    dropTarget,
    // Who has each file open: the threads drawn in that row.
    threadsFor: (id) => peers.filter((p) => p.activeFileId === id).map((p) => p.user.slot),
    toggle: (id) =>
      setExpanded((s) => {
        const next = new Set(s);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    open: onOpen,
    setDraft,
    setRenaming,
    setDropTarget,
    commitDraft: (name) => {
      if (!draft || name === null) return setDraft(null);
      const error = validateName(name);
      if (error) return void toast.error(error);
      const id =
        draft.kind === "file"
          ? createFile(doc, { name, parentId: draft.parentId, createdBy: me.user.id })
          : createFolder(doc, { name, parentId: draft.parentId, createdBy: me.user.id });
      if (draft.parentId) expand(draft.parentId);
      setDraft(null);
      if (draft.kind === "file") onOpen({ id, name, kind: "file" } as TreeNode);
    },
    commitRename: (id, name) => {
      if (name === null) return setRenaming(null);
      const error = validateName(name);
      if (error) return void toast.error(error);
      rename(doc, id, name);
      setRenaming(null);
    },
    drop: (event, folderId) => {
      event.preventDefault();
      // Files from your computer, not a row being moved.
      if (event.dataTransfer.files.length && !event.dataTransfer.getData("text/cc-node")) {
        setDropTarget(null);
        return void importUpload([...event.dataTransfer.files], folderId);
      }
      setDropTarget(null);
      const id = event.dataTransfer.getData("text/cc-node");
      if (!id || id === folderId) return;
      if (!move(doc, id, folderId)) toast.error("A folder can't be moved inside itself.");
      else if (folderId) expand(folderId);
    },
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-1 px-3">
        <span className="text-xs font-medium text-muted-foreground">Files</span>
        <div className="ml-auto flex">
          {editable && (
            <>
              <Button variant="ghost" size="icon-xs" aria-label="New file" onClick={() => setDraft({ kind: "file", parentId: null })}>
                <FilePlus2 />
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label="New folder" onClick={() => setDraft({ kind: "folder", parentId: null })}>
                <FolderPlus />
              </Button>
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label="More file actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {editable && (
                <>
                  <DropdownMenuItem onSelect={() => pickFiles.current?.click()}>
                    <Upload className="size-4" /> Upload files…
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => pickFolder.current?.click()}>
                    <FolderUp className="size-4" /> Upload a folder…
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => pickZip.current?.click()}>
                    <FileArchive className="size-4" /> Import a zip…
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                onSelect={() => {
                  const id = toast.loading("Making the zip…");
                  void downloadZip(doc, room.id, `${safeName(room.name, "room")}-${room.id}.zip`)
                    .then(({ files, missing }) => {
                      const what = files === 1 ? "Downloading 1 file as a zip." : `Downloading ${files} files as a zip.`;
                      if (missing.length) toast.warning(`${what} ${missing.length === 1 ? `${missing[0]} is` : `${missing.length} binary files are`} missing from it: their bytes couldn't be loaded.`, { id });
                      else toast.success(what, { id });
                    })
                    .catch(() => toast.error("Couldn't make the zip. Try again.", { id }));
                }}
              >
                <Download className="size-4" /> Download as zip
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {editable && (
            <>
              <input ref={pickFiles} type="file" multiple hidden aria-label="Files to upload" onChange={(e) => picked(e.currentTarget)} />
              <input
                ref={(input) => {
                  pickFolder.current = input;
                  // A folder picker keeps each file's path inside the folder.
                  input?.setAttribute("webkitdirectory", "");
                }}
                type="file"
                hidden
                aria-label="Folder to upload"
                onChange={(e) => picked(e.currentTarget)}
              />
              <input ref={pickZip} type="file" accept=".zip,application/zip" hidden aria-label="Zip to import" onChange={(e) => picked(e.currentTarget)} />
            </>
          )}
        </div>
      </div>
      <div
        role="tree"
        aria-label="Files"
        className={cn("min-h-0 flex-1 overflow-y-auto pb-6", dropTarget === "root" && "bg-brand-muted/40")}
        onDragOver={(e) => {
          if (!editable) return;
          e.preventDefault();
          if (e.target === e.currentTarget) setDropTarget("root");
        }}
        onDrop={(e) => ctx.drop(e, null)}
      >
        {draft?.parentId === null && <DraftRow draft={draft} depth={0} onDone={ctx.commitDraft} />}
        {tree.map((node) => (
          <TreeRow key={node.id} node={node} depth={0} ctx={ctx} />
        ))}
        {tree.length === 0 && !draft && (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            {editable ? "No files yet. Create one to start." : "This room has no files yet."}
          </p>
        )}
      </div>
    </div>
  );
}

function TreeRow({ node, depth, ctx }: { node: TreeNode; depth: number; ctx: TreeCtx }) {
  const isFolder = node.kind === "folder";
  const open = ctx.expanded.has(node.id);
  const active = node.id === ctx.activeFileId;

  const row = (
    <div
      role="treeitem"
      aria-expanded={isFolder ? open : undefined}
      aria-selected={active}
      tabIndex={0}
      draggable={ctx.editable && ctx.renaming !== node.id}
      onDragStart={(e) => e.dataTransfer.setData("text/cc-node", node.id)}
      onDragOver={(e) => {
        if (!isFolder || !ctx.editable) return;
        e.preventDefault();
        e.stopPropagation();
        ctx.setDropTarget(node.id);
      }}
      onDragLeave={() => ctx.setDropTarget(null)}
      onDrop={(e) => {
        if (!isFolder) return;
        e.stopPropagation();
        ctx.drop(e, node.id);
      }}
      onClick={() => (isFolder ? ctx.toggle(node.id) : ctx.open(node))}
      onKeyDown={(e) => {
        if (e.key === "Enter") (isFolder ? ctx.toggle(node.id) : ctx.open(node));
        if (!ctx.editable) return;
        if (e.key === "F2") ctx.setRenaming(node.id);
        if (e.key === "Delete") trash(ctx.doc, node.id);
      }}
      className={cn(
        "group relative flex h-row cursor-pointer items-center gap-1.5 pr-2 text-sm select-none hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset",
        active ? "bg-accent text-foreground" : "text-muted-foreground",
        ctx.dropTarget === node.id && "bg-brand-muted",
      )}
      style={{ paddingLeft: 8 + depth * 12 }}
    >
      {active && <span aria-hidden className="absolute inset-y-0 left-0 w-thread bg-brand" />}
      {isFolder ? (
        <>
          <ChevronRight className={cn("size-3.5 shrink-0 transition-transform duration-150", open && "rotate-90")} />
          {open ? <FolderOpen className="size-3.5 shrink-0" /> : <Folder className="size-3.5 shrink-0" />}
        </>
      ) : (
        <FileKindIcon node={node} />
      )}
      {ctx.renaming === node.id ? (
        <InlineName initial={node.name} onDone={(name) => ctx.commitRename(node.id, name)} />
      ) : (
        <span className="truncate">{node.name}</span>
      )}
      <Threads slots={ctx.threadsFor(node.id)} className="ml-auto h-3.5" />
    </div>
  );

  return (
    <>
      {ctx.editable ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
          <ContextMenuContent className="w-48">
            {isFolder && (
              <>
                <ContextMenuItem onSelect={() => ctx.setDraft({ kind: "file", parentId: node.id })}>
                  <FilePlus2 className="size-4" /> New file
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => ctx.setDraft({ kind: "folder", parentId: node.id })}>
                  <FolderPlus className="size-4" /> New folder
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            <ContextMenuItem onSelect={() => ctx.setRenaming(node.id)}>
              <Pencil className="size-4" /> Rename
            </ContextMenuItem>
            <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={() => trash(ctx.doc, node.id)}>
              <Trash2 className="size-4" /> Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        row
      )}
      {isFolder && open && (
        <>
          {ctx.draft?.parentId === node.id && <DraftRow draft={ctx.draft} depth={depth + 1} onDone={ctx.commitDraft} />}
          {node.children.map((child) => (
            <TreeRow key={child.id} node={child} depth={depth + 1} ctx={ctx} />
          ))}
        </>
      )}
    </>
  );
}

/** A text file's icon, or one that says what a binary file is (image, sound, video, font, archive). */
function FileKindIcon({ node }: { node: TreeNode }) {
  const className = "ml-5 size-3.5 shrink-0";
  if (!node.blob) return <FileText className={className} />;
  const view = blobView(node.blob.type);
  if (view === "image") return <FileImage className={className} />;
  if (view === "audio") return <FileAudio className={className} />;
  if (view === "video") return <FileVideo className={className} />;
  if (view === "font") return <FileType className={className} />;
  if (view === "pdf") return <FileText className={className} />;
  if (/zip|gzip|tar|java-archive/.test(node.blob.type)) return <FileArchive className={className} />;
  return <FileIcon className={className} />;
}

function DraftRow({ draft, depth, onDone }: { draft: NonNullable<Draft>; depth: number; onDone: (name: string | null) => void }) {
  return (
    <div className="flex h-row items-center gap-1.5 pr-2" style={{ paddingLeft: 8 + depth * 12 + (draft.kind === "file" ? 20 : 0) }}>
      {draft.kind === "folder" ? (
        <Folder className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <InlineName initial="" placeholder={draft.kind === "file" ? "name.ext" : "folder"} onDone={onDone} />
    </div>
  );
}

/** Enter commits, Escape or blur-with-no-change cancels. */
function InlineName({ initial, placeholder, onDone }: { initial: string; placeholder?: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const finish = () => onDone(value.trim() && value !== initial ? value : null);
  return (
    <input
      autoFocus
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => {
        // Select the name without its extension, like VS Code.
        const dot = e.target.value.lastIndexOf(".");
        e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        // preventDefault: the new file opens and takes the focus at once, and this
        // Enter would otherwise carry on into it as a blank first line.
        if (e.key === "Enter") {
          e.preventDefault();
          finish();
        }
        if (e.key === "Escape") onDone(null);
      }}
      onBlur={finish}
      className="h-5 min-w-0 flex-1 rounded-sm border border-ring bg-background px-1 font-mono text-xs text-foreground outline-none"
    />
  );
}
