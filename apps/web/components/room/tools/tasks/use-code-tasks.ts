/** Scan the existing room text sources in short browser turns, publishing only complete, bounded code-card views. */
"use client";

import { codeTaskCard, codeTaskKey, maps, MAX_CODE_TASKS, readTasks, scanCodeTasks, textOf, type TaskCard } from "@codechatter/workspace-model";
import { useEffect, useState } from "react";
import type * as Y from "yjs";

import { useRoomFiles } from "@/components/room/editor/room-files";
import { useRoom } from "@/components/room/room-context";
import { MAX_FILE_CHARS } from "@/components/room/search/search";

type Scan = { cards: TaskCard[]; capped: boolean; skipped: number; scanning: boolean; ready: boolean; unread: string[] };
const DEBOUNCE_MS = 250;
const TURN_MS = 5;

export function useCodeTasks(tasks: Y.Doc): Scan {
  const { doc } = useRoom();
  const files = useRoomFiles();
  const [result, setResult] = useState<Scan>({ cards: [], capped: false, skipped: 0, scanning: true, ready: false, unread: [] });
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let work: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;
    let disposed = false;
    const schedule = () => {
      const current = ++generation;
      clearTimeout(debounce);
      clearTimeout(work);
      debounce = setTimeout(() => {
        setResult((previous) => ({ ...previous, scanning: true }));
        const found = new Map<string, TaskCard>();
        const tracked = readTasks(tasks).filter((card) => card.source);
        const trackedIds = new Set(tracked.map((card) => card.id));
        const unread = new Set<string>();
        let fileIndex = 0;
        let skipped = 0;
        let capped = false;
        let active: { fileId: string; iterator: ReturnType<typeof scanCodeTasks> } | null = null;
        const finish = (capped: boolean) => {
          // A large/unavailable source says nothing about whether its old
          // comment still exists. Keep its last snapshot, with the skip notice.
          for (const card of tracked) if (unread.has(card.source!.fileId) && !found.has(card.id)) found.set(card.id, card);
          if (!disposed && current === generation) setResult({ cards: [...found.values()], capped, skipped, scanning: false, ready: true, unread: [...unread] });
        };
        const step = () => {
          if (disposed || current !== generation) return;
          const end = performance.now() + TURN_MS;
          while (performance.now() < end) {
            if (!active) {
              const file = files[fileIndex++];
              if (!file) { finish(capped); return; }
              // The search view's reader and size-before-copy guard: binary
              // files have no source, and large Y.Texts are never copied.
              const source = textOf(doc, file.id);
              if (!source) { unread.add(file.id); continue; }
              if (source.length > MAX_FILE_CHARS) { skipped++; unread.add(file.id); continue; }
              active = { fileId: file.id, iterator: scanCodeTasks(file.path, source.toString()) };
            }
            const next = active.iterator.next();
            if (next.done) { active = null; continue; }
            if (!next.value) continue;
            const key = codeTaskKey(active.fileId, next.value.marker, next.value.text);
            if (found.has(key)) continue;
            // Keep checking previously moved Doing cards after the display
            // limit, so a real comment past the limit is never called removed.
            if (found.size >= MAX_CODE_TASKS && !trackedIds.has(key)) { capped = true; continue; }
            found.set(key, codeTaskCard(active.fileId, next.value));
          }
          work = setTimeout(step, 0);
        };
        work = setTimeout(step, 0);
      }, DEBOUNCE_MS);
    };
    const contents = maps(doc).contents;
    contents.observeDeep(schedule);
    tasks.on("afterTransaction", schedule);
    schedule();
    return () => {
      disposed = true;
      generation++;
      clearTimeout(debounce);
      clearTimeout(work);
      contents.unobserveDeep(schedule);
      tasks.off("afterTransaction", schedule);
    };
  }, [doc, files, tasks]);
  return result;
}
