/** A text box bound to a Y.Text, for the Prompts tool: two people can type in it at once, and Ctrl+Enter runs. */
"use client";

import { PROMPT_LIMITS } from "@codechatter/contracts";
import type * as Y from "yjs";

import { useYText } from "@/components/room/tools/api-studio/use-y-text";

export const FIELD = "w-full resize-y rounded-md border bg-background px-2 py-1.5 font-mono text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70";

export function Field({ text, label, editable, rows, placeholder, onRun, onFocus }: { text: Y.Text | undefined; label: string; editable: boolean; rows: number; placeholder?: string; onRun: () => void; onFocus?: () => void }) {
  const { value, onChange, ref } = useYText<HTMLTextAreaElement>(text);
  return (
    <textarea
      ref={ref}
      aria-label={label}
      rows={rows}
      value={value}
      disabled={!editable}
      spellCheck={false}
      placeholder={placeholder}
      className={FIELD}
      maxLength={PROMPT_LIMITS.messageChars}
      onFocus={onFocus}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          onRun();
        }
      }}
    />
  );
}
