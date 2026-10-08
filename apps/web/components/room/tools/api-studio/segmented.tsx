"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** A small single-choice control, like radio buttons drawn as a row of segments. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled,
  className,
}: {
  options: Array<{ id: T; label: ReactNode }>;
  value: T;
  onChange: (id: T) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const group = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent) => {
    const index = options.findIndex((o) => o.id === value);
    const move = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!move || disabled) return;
    event.preventDefault();
    const next = options[(index + move + options.length) % options.length]!;
    onChange(next.id);
    group.current?.querySelector<HTMLElement>(`[data-id="${next.id}"]`)?.focus();
  };

  return (
    <div ref={group} role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={cn("inline-flex h-7 items-center gap-0.5 rounded-md border p-0.5", className)}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          data-id={option.id}
          aria-checked={value === option.id}
          tabIndex={value === option.id ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange(option.id)}
          className={cn(
            "inline-flex h-5 items-center rounded-sm px-2 text-xs font-medium whitespace-nowrap disabled:pointer-events-none disabled:opacity-60",
            value === option.id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
