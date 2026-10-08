"use client";

import { ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";

import { cn } from "@/lib/utils";

/** How one suggestion looks in the popup. */
export type MenuEntry = { key: string; label: string; hint?: string; icon: ReactNode; section?: string };

type ListHandle = { onKeyDown: (event: KeyboardEvent) => boolean };

type ListProps<I> = {
  items: I[];
  query: string;
  label: string;
  empty: string;
  describe: (item: I) => MenuEntry;
  onPick: (item: I) => void;
  ref?: Ref<ListHandle>;
};

/**
 * The popup under the caret for `/` commands and `[[` links. Keys stay in the
 * editor (the suggestion plugin forwards them here), so typing keeps filtering.
 */
function SuggestionList<I>({ items, query, label, empty, describe, onPick, ref }: ListProps<I>) {
  // The highlight resets to the first item whenever the query changes.
  const [cursor, setCursor] = useState({ query, index: 0 });
  const active = cursor.query === query ? Math.min(cursor.index, items.length - 1) : 0;
  const list = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (items.length === 0) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const step = event.key === "ArrowDown" ? 1 : -1;
        setCursor({ query, index: (active + step + items.length) % items.length });
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const item = items[active];
        if (item) onPick(item);
        return true;
      }
      return false;
    },
  }));

  useEffect(() => {
    list.current?.querySelector("[aria-selected=true]")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const entries = items.map(describe);
  return (
    <div
      ref={list}
      role="listbox"
      aria-label={label}
      className="max-h-80 w-72 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      // Keep the editor focused while clicking an item.
      onMouseDown={(event) => event.preventDefault()}
    >
      {entries.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">{empty}</p>}
      {entries.map((entry, index) => (
        <div key={entry.key}>
          {entry.section && entry.section !== entries[index - 1]?.section && (
            <p className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">{entry.section}</p>
          )}
          <button
            type="button"
            role="option"
            aria-selected={index === active}
            tabIndex={-1}
            onClick={() => onPick(items[index]!)}
            onMouseEnter={() => setCursor({ query, index })}
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm",
              index === active ? "bg-accent text-accent-foreground" : "text-foreground",
            )}
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-sm border bg-background text-muted-foreground [&_svg]:size-3.5">
              {entry.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{entry.label}</span>
              {entry.hint && <span className="block truncate text-xs text-muted-foreground">{entry.hint}</span>}
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}

/** A suggestion `render` that mounts SuggestionList at the caret and keeps it in place. */
export function renderSuggestion<I>(config: Pick<ListProps<I>, "label" | "empty" | "describe">): SuggestionOptions<I, I>["render"] {
  return () => {
    let component: ReactRenderer<ListHandle, ListProps<I>> | null = null;
    let unmount: (() => void) | null = null;
    const toProps = (props: SuggestionProps<I, I>): ListProps<I> => ({
      ...config,
      items: props.items,
      query: props.query,
      onPick: (item) => props.command(item),
    });
    return {
      onStart: (props) => {
        component = new ReactRenderer(SuggestionList<I>, { editor: props.editor, props: toProps(props), className: "z-popover" });
        unmount = props.mount(component.element);
      },
      onUpdate: (props) => component?.updateProps(toProps(props)),
      onKeyDown: ({ event }) => component?.ref?.onKeyDown(event) ?? false,
      onExit: () => {
        unmount?.();
        unmount = null;
        component?.destroy();
        component = null;
      },
    };
  };
}
