"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type StudioTab<T extends string> = { id: T; label: ReactNode; hidden?: boolean };

/**
 * Tabs in the same style as the room's side panel: text with an orange
 * underline on the active one. Arrow keys move between tabs.
 */
export function StudioTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
  children,
}: {
  tabs: Array<StudioTab<T>>;
  value: T;
  onChange: (id: T) => void;
  label: string;
  className?: string;
  /** Extra controls on the right of the tab row. */
  children?: ReactNode;
}) {
  const uid = useId();
  const list = useRef<HTMLDivElement>(null);
  const shown = tabs.filter((tab) => !tab.hidden);

  const onKeyDown = (event: KeyboardEvent) => {
    const index = shown.findIndex((tab) => tab.id === value);
    const move = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const target = event.key === "Home" ? shown[0] : event.key === "End" ? shown.at(-1) : move ? shown[(index + move + shown.length) % shown.length] : undefined;
    if (!target) return;
    event.preventDefault();
    onChange(target.id);
    list.current?.querySelector<HTMLElement>(`[data-tab="${target.id}"]`)?.focus();
  };

  return (
    <div className={cn("flex h-8 shrink-0 items-stretch gap-3 border-b px-3", className)}>
      <div ref={list} role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex min-w-0 items-stretch gap-3 overflow-x-auto overflow-y-hidden [scrollbar-width:none]">
        {shown.map((tab) => (
          <button
            key={tab.id}
            id={`${uid}-${tab.id}`}
            data-tab={tab.id}
            role="tab"
            type="button"
            aria-selected={value === tab.id}
            tabIndex={value === tab.id ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap",
              value === tab.id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {value === tab.id && <span aria-hidden className="absolute inset-x-0 -bottom-px h-[2px] bg-brand" />}
          </button>
        ))}
      </div>
      {children && <div className="ml-auto flex items-center gap-1">{children}</div>}
    </div>
  );
}

/** A count next to a tab label, shown only when there is something to count. */
export function TabCount({ n }: { n: number }) {
  return n > 0 ? <span className="rounded-full bg-muted px-1.5 text-2xs tabular-nums text-muted-foreground">{n}</span> : null;
}
