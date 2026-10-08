"use client";

import { setText } from "@codechatter/workspace-model";
import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type * as Y from "yjs";

type Field = HTMLInputElement | HTMLTextAreaElement;
type Delta = Array<{ retain?: number; insert?: unknown; delete?: number }>;

/** Where a caret ends up after someone else's edit (text inserted at the caret stays after it). */
export function shiftPosition(position: number, delta: Delta): number {
  let index = 0;
  let shift = 0;
  for (const op of delta) {
    if (op.retain) index += op.retain;
    else if (op.insert !== undefined) {
      if (index < position) shift += typeof op.insert === "string" ? op.insert.length : 1;
    } else if (op.delete) {
      const end = index + op.delete;
      if (end <= position) shift -= op.delete;
      else if (index < position) shift -= position - index;
      index = end;
    }
  }
  return Math.max(0, position + shift);
}

/**
 * Bind a Y.Text to an <input> or <textarea>. Local typing becomes the
 * smallest Yjs edit; someone else's edit keeps your caret where it was
 * relative to the text around it instead of jumping to the end.
 */
export function useYText<E extends Field = Field>(text: Y.Text | undefined, write?: (next: string) => void) {
  const ref = useRef<E | null>(null);
  const caret = useRef<[number, number] | null>(null);

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!text) return () => {};
      const handler = (event: Y.YTextEvent, transaction: Y.Transaction) => {
        const field = ref.current;
        if (!transaction.local && field && document.activeElement === field) {
          const delta = event.delta as Delta;
          caret.current = [shiftPosition(field.selectionStart ?? 0, delta), shiftPosition(field.selectionEnd ?? 0, delta)];
        }
        onChange();
      };
      text.observe(handler);
      return () => text.unobserve(handler);
    },
    [text],
  );
  const value = useSyncExternalStore(subscribe, () => text?.toString() ?? "", () => "");

  useLayoutEffect(() => {
    const field = ref.current;
    const next = caret.current;
    if (field && next) {
      caret.current = null;
      field.setSelectionRange(next[0], next[1]);
    }
  }, [value]);

  const onChange = useCallback(
    (next: string) => {
      if (!text) return;
      if (write) write(next);
      else setText(text, next);
    },
    [text, write],
  );

  return { value, onChange, ref };
}
