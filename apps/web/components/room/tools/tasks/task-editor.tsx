/** Edit hand-written card fields in a labeled dialog, leaving all shared writes to the board's model actions. */
"use client";

import { MAX_TASK_DESCRIPTION, MAX_TASK_TITLE, type TaskCard } from "@codechatter/workspace-model";
import { useId, useState } from "react";

import type { RoomMember } from "@/components/room/code-comments/notify";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type TaskFields = { title: string; description: string; assigneeId: string | null };

export function TaskEditor({ card, members, onClose, onSave }: { card: TaskCard | null; members: RoomMember[]; onClose: () => void; onSave: (fields: TaskFields) => void }) {
  const [title, setTitle] = useState(card?.title ?? "");
  const [description, setDescription] = useState(card?.description ?? "");
  const [assignee, setAssignee] = useState(card?.assigneeId ?? "");
  const id = useId();
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent data-own-run-key className="text-[13px] sm:max-w-md">
        <DialogHeader><DialogTitle>{card ? "Edit task" : "Add task"}</DialogTitle><DialogDescription>Everyone in the room sees this task.</DialogDescription></DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); if (title.trim()) onSave({ title, description, assigneeId: assignee || null }); }} className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor={`${id}-title`}>Title</Label><Input id={`${id}-title`} autoFocus required maxLength={MAX_TASK_TITLE} value={title} onChange={(event) => setTitle(event.target.value)} className="h-8 text-[13px]" /></div>
          <div className="grid gap-1.5"><Label htmlFor={`${id}-description`}>Description</Label><Textarea id={`${id}-description`} maxLength={MAX_TASK_DESCRIPTION} value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-24 text-[13px]" /></div>
          <div className="grid gap-1.5"><Label htmlFor={`${id}-assignee`}>Assignee</Label><select id={`${id}-assignee`} value={assignee} onChange={(event) => setAssignee(event.target.value)} className="h-8 w-full rounded-md border border-input bg-background px-2 text-[13px]"><option value="">Unassigned</option>{assignee && !members.some((member) => member.id === assignee) && <option value={assignee}>Former member</option>}{members.map((member) => <option key={member.id} value={member.id}>{member.name || "Unnamed member"}</option>)}</select></div>
          <DialogFooter><Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" disabled={!title.trim()}>{card ? "Save changes" : "Add task"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
