/** The room's shared task board merges manual cards with bounded live code comments and keeps all movement keyboard-accessible. */
"use client";

import { addTask, assignTask, deleteTask, editTask, MAX_CODE_TASKS, moveTask, readTasks, TASK_COLUMNS, type BoardTask, type TaskCard, type TaskColumn } from "@codechatter/workspace-model";
import { ChevronDown, Code2, GripVertical, Plus, X } from "lucide-react";
import { useId, useMemo, useState, type DragEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { PresenceAvatar, slotFor } from "@/components/presence/presence";
import { useRoomMembers, type RoomMember } from "@/components/room/code-comments/notify";
import { revealInFile } from "@/components/room/editor/reveal";
import { useRoomFiles } from "@/components/room/editor/room-files";
import { useRoom } from "@/components/room/room-context";
import type { RoomToolProps } from "@/components/room/tools/registry";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import { useTasksConnection, useTasksVersion, type TasksConnection } from "./connection";
import { TaskEditor, type TaskFields } from "./task-editor";
import { useCodeTasks } from "./use-code-tasks";

const DRAG_TYPE = "application/x-codechatter-task";
type Filter = "all" | "code" | "mine";
type Editing = { card: TaskCard | null; column: TaskColumn };

export default function TasksTool(props: RoomToolProps) {
  const { room } = useRoom();
  const connection = useTasksConnection(room.id);
  return (
    <section aria-label="Task board" data-own-run-key className="flex h-full min-h-0 flex-col bg-panel text-[13px]">
      {!connection || !connection.synced ? <div className="flex items-center gap-2 p-3"><p role="status" className="flex-1 text-muted-foreground">{connection?.status === "denied" ? "The task board could not be opened. Reload the room to check your access." : "Opening the task board..."}</p><Button size="icon-xs" variant="ghost" aria-label="Close task board" onClick={props.close}><X /></Button></div> : <TaskBoard {...props} connection={connection} />}
    </section>
  );
}

function TaskBoard({ connection, openFile, close }: RoomToolProps & { connection: TasksConnection }) {
  const { me, can } = useRoom();
  const revision = useTasksVersion(connection.doc);
  const files = useRoomFiles();
  const scan = useCodeTasks(connection.doc);
  const members = useRoomMembers();
  const people = members.some((member) => member.id === me.user.id) ? members : [{ id: me.user.id, name: me.user.name, image: me.user.image ?? null, role: "member" }, ...members];
  const editable = can("files.edit") && connection.status !== "denied";
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const id = useId();
  // Y.Doc is mutable without changing identity. The external-store revision
  // must invalidate this read even when the compiler caches ordinary values.
  const all = useMemo(() => {
    void revision;
    // Until the first complete scan, absent code means "not checked yet".
    return readTasks(connection.doc, scan.cards).filter((card) => !card.source || scan.ready);
  }, [connection.doc, revision, scan.cards, scan.ready]);
  // Retained Doing cards get priority, so reaching the scan cap cannot hide
  // a task whose code was removed while someone was working on it.
  const fromCode = [...all.filter((card) => card.source && card.noLongerInCode), ...all.filter((card) => card.source && !card.noLongerInCode)];
  const allowed = new Set(fromCode.slice(0, MAX_CODE_TASKS).map((card) => card.id));
  const cards = all.filter((card) => (!card.source || allowed.has(card.id)) && (filter !== "code" || card.source) && (filter !== "mine" || card.assigneeId === me.user.id));
  const capped = scan.capped || fromCode.length > MAX_CODE_TASKS;

  const move = (card: TaskCard, column: TaskColumn, beforeId: string | null = null) => {
    if (!editable) return;
    if (moveTask(connection.doc, card, column, beforeId)) setAnnouncement(`${card.title} moved to ${TASK_COLUMNS.find((item) => item.id === column)?.label}.`);
  };
  const keyMove = (event: KeyboardEvent<HTMLDivElement>, card: BoardTask) => {
    if (!editable || event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const next = TASK_COLUMNS[TASK_COLUMNS.findIndex((column) => column.id === card.column) + (event.key === "ArrowLeft" ? -1 : 1)];
    if (next) move(card, next.id);
    // A card changes DOM parents when it changes columns. Restore its keyboard
    // focus in the next paint instead of letting focus fall onto the page.
    requestAnimationFrame(() => document.getElementById(`${id}-${card.id}`)?.focus());
  };
  const drop = (event: DragEvent<HTMLElement>, column: TaskColumn) => {
    if (!editable) return;
    event.preventDefault();
    const taskId = event.dataTransfer.getData(DRAG_TYPE);
    const card = cards.find((item) => item.id === taskId);
    if (card) move(card, column);
  };
  const save = (fields: TaskFields) => {
    if (!editable || !editing) return;
    if (editing.card) {
      // Only publish the fields changed in this dialog; another person's
      // assignment or title edit must survive an unrelated description save.
      const patch: Parameters<typeof editTask>[2] = {};
      if (fields.title !== editing.card.title) patch.title = fields.title;
      if (fields.description !== editing.card.description) patch.description = fields.description;
      if (!editTask(connection.doc, editing.card.id, patch)) { toast.error("This task is no longer available."); return; }
      if (fields.assigneeId !== editing.card.assigneeId) assignTask(connection.doc, editing.card, fields.assigneeId);
    } else if (!addTask(connection.doc, { ...fields, column: editing.column, createdBy: me.user.id })) { toast.error("Enter a title for the task."); return; }
    setEditing(null);
  };
  const openSource = (card: BoardTask) => {
    const file = files.find((item) => item.id === card.source?.fileId);
    if (!file || !card.source) return;
    openFile(file.id);
    revealInFile(file, { startLine: card.source.line, startColumn: 1, endLine: card.source.line, endColumn: 1 });
  };

  return (
    <>
      <header className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5"><h1 className="mr-auto font-medium">Tasks</h1><label className="sr-only" htmlFor={`${id}-filter`}>Task filter</label><select id={`${id}-filter`} value={filter} onChange={(event) => setFilter(event.target.value as Filter)} className="h-7 rounded-md border border-input bg-background px-2 text-xs"><option value="all">Everything</option><option value="code">From the code</option><option value="mine">Only mine</option></select><Button size="icon-xs" variant="ghost" aria-label="Close task board" onClick={close}><X /></Button></header>
      <div className="grid shrink-0 gap-1 px-3 py-2 text-xs text-muted-foreground">
        {!editable && <p>You can read this board. Editing tasks needs file-editing permission.</p>}
        {editable && <p id={`${id}-keys`}>Use a card&apos;s Move menu or focus it and press Left or Right to change columns.</p>}
        {connection.status === "offline" && <p role="status">Offline. Keep this board open so changes can sync when you reconnect.</p>}
        {scan.scanning && <p role="status">Scanning code...</p>}
        {capped && <p role="status">Up to {MAX_CODE_TASKS} cards from code are shown. There are more in this room.</p>}
        {scan.skipped > 0 && <p>{scan.skipped} {scan.skipped === 1 ? "file is" : "files are"} too large to scan.</p>}
        {!scan.scanning && cards.length === 0 && <p>{filter === "all" ? "Add a task or write a TODO comment in a file to start the board." : "No tasks match this filter."}</p>}
      </div>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-1 gap-3 overflow-auto px-3 pb-3 md:grid-cols-3">
        {TASK_COLUMNS.map((column) => {
          const inColumn = cards.filter((card) => card.column === column.id);
          return <section key={column.id} role="region" aria-labelledby={`${id}-${column.id}`} onDragOver={(event) => { if (editable && event.dataTransfer.types.includes(DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }} onDrop={(event) => drop(event, column.id)} className="flex min-h-32 min-w-0 flex-col rounded-md border bg-background">
            <div className="flex min-h-9 shrink-0 items-center gap-2 border-b px-2"><h2 id={`${id}-${column.id}`} className="font-medium">{column.label}</h2><span aria-label={`${inColumn.length} tasks`} className="text-xs text-muted-foreground">{inColumn.length}</span>{editable && <Button className="ml-auto" size="xs" variant="ghost" aria-label={`Add to ${column.label}`} onClick={() => setEditing({ card: null, column: column.id })}><Plus />Add</Button>}</div>
            <ol aria-label={`${column.label} tasks`} className="grid content-start gap-2 p-2">
              {inColumn.map((card) => <li key={card.id}><TaskCardView card={card} domId={`${id}-${card.id}`} editable={editable} keysId={`${id}-keys`} people={people} filePath={files.find((file) => file.id === card.source?.fileId)?.path ?? null} unread={Boolean(card.source && scan.unread.includes(card.source.fileId))} onKey={(event) => keyMove(event, card)} onMove={(next) => move(card, next)} onEdit={() => setEditing({ card, column: card.column })} onDelete={() => { if (editable) deleteTask(connection.doc, card.id); }} onAssign={(assignee) => { if (editable) assignTask(connection.doc, card, assignee); }} onOpen={() => openSource(card)} /></li>)}
            </ol>
          </section>;
        })}
      </div>
      {editing && editable && <TaskEditor key={editing.card?.id ?? `new-${editing.column}`} card={editing.card} members={people} onClose={() => setEditing(null)} onSave={save} />}
    </>
  );
}

function TaskCardView({ card, domId, editable, keysId, people, filePath, unread, onKey, onMove, onEdit, onDelete, onAssign, onOpen }: { card: BoardTask; domId: string; editable: boolean; keysId: string; people: RoomMember[]; filePath: string | null; unread: boolean; onKey: (event: KeyboardEvent<HTMLDivElement>) => void; onMove: (column: TaskColumn) => void; onEdit: () => void; onDelete: () => void; onAssign: (id: string | null) => void; onOpen: () => void }) {
  const person = people.find((member) => member.id === card.assigneeId);
  return (
    <div id={domId} role="group" aria-label={`Task: ${card.title}`} aria-describedby={editable ? keysId : undefined} data-task-id={card.id} tabIndex={0} draggable={editable} onDragStart={(event) => { if (!editable) { event.preventDefault(); return; } event.dataTransfer.setData(DRAG_TYPE, card.id); event.dataTransfer.effectAllowed = "move"; }} onKeyDown={onKey} className="grid min-w-0 gap-2 rounded-md border bg-panel p-2 outline-offset-2">
      <div className="flex min-w-0 items-start gap-1.5">{editable && <GripVertical aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}<h3 className="min-w-0 flex-1 break-words font-medium">{card.title}</h3>{card.source && <span className="shrink-0 text-xs text-brand-text">{card.source.marker}</span>}</div>
      {card.source?.text && card.source.text !== card.title && <details><summary className="min-h-6 cursor-pointer py-1 text-xs text-muted-foreground">Full comment</summary><div tabIndex={0} role="group" aria-label="Full comment text" className="max-h-40 overflow-auto break-words whitespace-pre-wrap text-xs">{card.source.text}</div></details>}
      {card.description && <p className="break-words whitespace-pre-wrap text-xs text-muted-foreground">{card.description}</p>}
      {card.source && <div className="min-w-0 text-xs">{filePath ? <button type="button" aria-label={`Open ${filePath}:${card.source.line}`} onClick={onOpen} className="inline-flex min-h-6 max-w-full items-center gap-1 text-left text-muted-foreground underline underline-offset-2 hover:text-foreground"><Code2 className="size-3 shrink-0" /><span className="truncate">{filePath}:{card.source.line}</span></button> : <span className="text-muted-foreground">Deleted file:{card.source.line}</span>}{unread && <p className="mt-1 text-muted-foreground">Source too large or unavailable to scan.</p>}{card.noLongerInCode && <p className="mt-1 text-muted-foreground">No longer in the code</p>}</div>}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {card.assigneeId && <span title={person?.name ?? "Former member"} className="inline-flex min-h-6 items-center gap-1.5 text-xs"><PresenceAvatar size={20} name={person?.name ?? "Former member"} slot={slotFor(card.assigneeId)} image={person?.image} /><span className="max-w-32 truncate">{person?.name ?? "Former member"}</span></span>}
        {editable && <select aria-label={`Assign ${card.title}`} value={card.assigneeId ?? ""} onChange={(event) => onAssign(event.target.value || null)} className="h-6 min-w-0 max-w-full rounded-sm border border-input bg-background px-1 text-xs"><option value="">Unassigned</option>{card.assigneeId && !person && <option value={card.assigneeId}>Former member</option>}{people.map((member) => <option key={member.id} value={member.id}>{member.name || "Unnamed member"}</option>)}</select>}
      </div>
      {editable && <div className="flex flex-wrap items-center gap-1"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="xs" aria-label={`Move ${card.title}`}>Move<ChevronDown /></Button></DropdownMenuTrigger><DropdownMenuContent data-own-run-key>{TASK_COLUMNS.map((column) => <DropdownMenuItem key={column.id} disabled={column.id === card.column} onSelect={() => onMove(column.id)}>{column.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>{!card.source && <><Button variant="ghost" size="xs" aria-label={`Edit ${card.title}`} onClick={onEdit}>Edit</Button><Button variant="ghost" size="xs" aria-label={`Delete ${card.title}`} onClick={onDelete}>Delete</Button></>}{card.noLongerInCode && <Button variant="ghost" size="xs" aria-label={`Remove ${card.title}`} onClick={onDelete}>Remove</Button>}</div>}
    </div>
  );
}
