"use client";

import type * as Y from "yjs";

import { cn } from "@/lib/utils";

import { useYText } from "./use-y-text";

/** A multi-line code field kept in the shared document: two people can type in it at once. */
export function YTextArea({
  text,
  label,
  placeholder,
  readOnly,
  className,
  onKeyDown,
}: {
  text: Y.Text | undefined;
  label: string;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
}) {
  const { value, onChange, ref } = useYText<HTMLTextAreaElement>(text);
  return (
    <textarea
      ref={ref}
      value={value}
      readOnly={readOnly}
      aria-label={label}
      placeholder={placeholder}
      spellCheck={false}
      autoCapitalize="off"
      autoComplete="off"
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      className={cn("block h-full min-h-24 w-full resize-none bg-transparent p-3 font-mono text-sm outline-none placeholder:text-muted-foreground", className)}
    />
  );
}
