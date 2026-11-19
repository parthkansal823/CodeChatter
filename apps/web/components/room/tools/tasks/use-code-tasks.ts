/** Scan the existing room text sources in short browser turns, publishing only complete, bounded code-card views. */
"use client";

import { CodeTaskIndex, maps, readTasks, type TaskCard } from "@codechatter/workspace-model";
import { useEffect, useMemo, useState } from "react";
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
  const index = useMemo(() => new CodeTaskIndex(doc, MAX_FILE_CHARS), [doc]);
  const [result, setResult] = useState<Scan>({ cards: [], capped: false, skipped: 0, scanning: true, ready: false, unread: [] });
  useEffect(() => {
    index.setFiles(files);
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let work: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;
    let disposed = false;
    let iterator: ReturnType<CodeTaskIndex["scan"]> | undefined;
    const schedule = () => {
      const current = ++generation;
      clearTimeout(debounce);
      clearTimeout(work);
      iterator?.return({ cards: [], capped: false, skipped: 0, unread: [] });
      debounce = setTimeout(() => {
        setResult((previous) => ({ ...previous, scanning: true }));
        const tracked = readTasks(tasks).filter((card) => card.source);
        iterator = index.scan(tracked);
        const step = () => {
          if (disposed || current !== generation) return;
          const end = performance.now() + TURN_MS;
          while (performance.now() < end) {
            const next = iterator!.next();
            if (next.done) {
              if (!disposed && current === generation) setResult({ ...next.value, scanning: false, ready: true });
              return;
            }
          }
          work = setTimeout(step, 0);
        };
        work = setTimeout(step, 0);
      }, DEBOUNCE_MS);
    };
    const contents = maps(doc).contents;
    const changed = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => { if (index.invalidateContents(events)) schedule(); };
    contents.observeDeep(changed);
    tasks.on("afterTransaction", schedule);
    schedule();
    return () => {
      disposed = true;
      generation++;
      clearTimeout(debounce);
      clearTimeout(work);
      iterator?.return({ cards: [], capped: false, skipped: 0, unread: [] });
      contents.unobserveDeep(changed);
      tasks.off("afterTransaction", schedule);
    };
  }, [doc, files, tasks, index]);
  return result;
}
