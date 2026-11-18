/**
 * A step's field that offers expressions as they're typed, as n8n's editor does: `{{` opens a list of what the steps before give (every field inside them,
 * with a run's data), narrowed by what's typed, with a sample of each; arrows and Enter or Tab choose, Escape closes. What's offered is worked out in
 * expressions.ts (`suggestionsAt`).
 */
"use client";

import { useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { insertAt, suggestionsAt, type Suggestion } from "./expressions";

type Field = HTMLInputElement | HTMLTextAreaElement;
type Props = {
  value: string;
  onChange: (text: string) => void;
  multiline: boolean;
  /** What the steps before give (expressionsFor), and the shown run's data. */
  bases: string[];
  data: Record<string, unknown> | null;
  readOnly: boolean;
  className?: string;
  describedBy?: string;
  onFocus?: (event: FocusEvent<Field>) => void;
};

export function ExpressionInput({ value, onChange, multiline, bases, data, readOnly, className, describedBy, onFocus }: Props) {
  const [open, setOpen] = useState<{ start: number; end: number; items: Suggestion[] } | null>(null);
  const [active, setActive] = useState(0);
  const field = useRef<Field | null>(null);
  const listId = useId();

  const look = (element: Field) => {
    const found = readOnly ? null : suggestionsAt(element.value, element.selectionStart ?? element.value.length, bases, data);
    setOpen(found && found.items.length ? found : null);
    setActive(0);
  };
  const choose = (item: Suggestion) => {
    const element = field.current;
    if (!element || !open) return;
    const next = insertAt(element.value, open.start, open.end, item.expression);
    onChange(next.text);
    setOpen(null);
    // Back in the field, just after what was put in.
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(next.cursor, next.cursor);
    });
  };
  const onKeyDown = (event: KeyboardEvent<Field>) => {
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((at) => (at + (event.key === "ArrowDown" ? 1 : -1) + open.items.length) % open.items.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      choose(open.items[active]!);
    } else if (event.key === "Escape") {
      // Closes the list, not the panel it's in.
      event.preventDefault();
      event.stopPropagation();
      setOpen(null);
    }
  };
  const shared = {
    value,
    readOnly,
    spellCheck: false,
    "aria-describedby": describedBy,
    "aria-autocomplete": "list" as const,
    "aria-controls": open ? listId : undefined,
    "aria-activedescendant": open ? `${listId}-${active}` : undefined,
    onKeyDown,
    onFocus,
    // A choice made with the mouse lands before the field lets go.
    onBlur: () => setOpen(null),
  };

  return (
    <div className="relative min-w-0">
      {multiline ? (
        <Textarea
          {...shared}
          ref={(element) => {
            field.current = element;
          }}
          className={className}
          onChange={(event) => {
            onChange(event.target.value);
            look(event.target);
          }}
        />
      ) : (
        <Input
          {...shared}
          ref={(element) => {
            field.current = element;
          }}
          className={className}
          onChange={(event) => {
            onChange(event.target.value);
            look(event.target);
          }}
        />
      )}
      {open && (
        <ul id={listId} role="listbox" aria-label="What it can be" className="absolute inset-x-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-md border bg-popover p-1 text-xs text-popover-foreground shadow-md">
          {open.items.map((item, index) => (
            <li
              key={item.path}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={cn("flex cursor-pointer items-baseline gap-2 rounded px-2 py-1", index === active && "bg-accent")}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(item);
              }}
              onMouseEnter={() => setActive(index)}
            >
              <span className="min-w-0 truncate font-mono">{item.path}</span>
              {item.sample !== null && item.sample !== "" && <span className="ml-auto min-w-0 shrink truncate text-muted-foreground">{item.sample}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
