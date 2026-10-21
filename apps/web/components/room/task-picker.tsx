"use client";

import { PaletteDialog } from "@/components/room/editor/palette-dialog";
import { TASKS_PATH, type Task } from "@/components/room/editor/tasks";
import { CommandEmpty, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";

/** Run task… (and Ctrl+Shift+B when there's no default build task): the room's tasks to pick from. */
export function TaskPicker({ tasks, title, onRun, onClose }: { tasks: Task[]; title: string; onRun: (task: Task) => void; onClose: () => void }) {
  return (
    <PaletteDialog open onOpenChange={(open) => !open && onClose()} title={title} description="Pick a task to run in your Task terminal">
      <CommandInput placeholder="Task" className="h-9 py-0" />
      <CommandList className="max-h-[min(60vh,420px)]">
        <CommandEmpty>No tasks yet. Add {TASKS_PATH}, or scripts to a package.json.</CommandEmpty>
        {tasks.map((task, i) => (
          <CommandItem
            key={`${task.label}-${i}`}
            value={`${task.label} ${task.command} ${i}`}
            onSelect={() => {
              onClose();
              onRun(task);
            }}
            className="py-1.5"
          >
            <span className="truncate">{task.label}</span>
            <CommandShortcut className="max-w-[45%] truncate">{task.group ?? task.command}</CommandShortcut>
          </CommandItem>
        ))}
      </CommandList>
    </PaletteDialog>
  );
}
