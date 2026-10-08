"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { resolveColor } from "@/lib/css-color";
import { cn } from "@/lib/utils";

import { colorLabel, cssColor, DESIGN_SWATCHES, type Swatch } from "./palette";

/** A label above a control, in the properties panel's two-column grid. */
export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-1", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="grid gap-2 border-b px-3 py-3">
      <h3 className="text-xs font-medium">{title}</h3>
      {children}
    </section>
  );
}

/**
 * A number the user types: edits are local until Enter or blur, then written
 * once (so one edit is one undo step). Arrow keys step by 1, or 10 with Shift.
 * `value: null` means the selection disagrees; the box shows "Mixed".
 */
export function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  step = 1,
  suffix,
  disabled,
  className,
}: {
  label: string;
  value: number | null;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === null ? "" : String(Math.round(value * 100) / 100));
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const commit = (text: string) => {
    setDraft(null);
    if (text.trim() === "") return;
    const n = Number(text);
    if (Number.isFinite(n) && n !== value) onCommit(clamp(n));
  };
  return (
    <label className={cn("flex h-7 items-center gap-1.5 rounded-md border border-input bg-background px-2 text-sm focus-within:border-ring", disabled && "opacity-50", className)}>
      <span className="w-3 shrink-0 text-xs text-muted-foreground" aria-hidden>
        {label.slice(0, 1)}
      </span>
      <input
        aria-label={label}
        inputMode="decimal"
        disabled={disabled}
        value={shown}
        placeholder={value === null ? "Mixed" : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => draft !== null && commit(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") commit(e.currentTarget.value);
          else if (e.key === "Escape") setDraft(null);
          else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const base = Number(draft ?? value ?? 0);
            const next = clamp((Number.isFinite(base) ? base : 0) + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
            setDraft(null);
            onCommit(next);
          }
        }}
        className="min-w-0 flex-1 bg-transparent tabular-nums outline-none placeholder:text-muted-foreground"
      />
      {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
    </label>
  );
}

/** A text box that saves on Enter or blur. */
export function TextField({ label, value, onCommit, disabled }: { label: string; value: string; onCommit: (value: string) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (text: string) => {
    setDraft(null);
    const next = text.trim();
    if (next && next !== value) onCommit(next.slice(0, 120));
  };
  return (
    <input
      aria-label={label}
      disabled={disabled}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => draft !== null && commit(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit(e.currentTarget.value);
        if (e.key === "Escape") setDraft(null);
      }}
      className="h-7 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring disabled:opacity-50"
    />
  );
}

/**
 * A colour control: a swatch that opens the design tokens plus a custom
 * colour. Picking a token stores the token ("var(--p-2)"), so the colour
 * follows the theme; the custom picker stores what the user chose.
 */
export function ColorField({
  label,
  value,
  onChange,
  swatches = DESIGN_SWATCHES,
  allowNone = true,
  disabled,
}: {
  label: string;
  /** A stored colour, or null when the selection disagrees. */
  value: string | null;
  onChange: (color: string) => void;
  swatches?: Swatch[];
  allowNone?: boolean;
  disabled?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${value === null ? "mixed" : colorLabel(value)}`}
          disabled={disabled}
          className="flex h-7 w-full items-center gap-2 rounded-md border border-input bg-background px-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
        >
          <Swatch color={value} />
          <span className="min-w-0 flex-1 truncate">{value === null ? "Mixed" : colorLabel(value)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-3" onKeyDown={(e) => e.stopPropagation()}>
        <ColorPicker label={label} value={value} onChange={onChange} swatches={swatches} allowNone={allowNone} />
      </PopoverContent>
    </Popover>
  );
}

/** A small square showing a colour; no colour is drawn as a diagonal slash. */
export function Swatch({ color, className }: { color: string | null; className?: string }) {
  const none = color === "none" || color === "";
  return (
    <span
      aria-hidden
      className={cn("relative size-4 shrink-0 overflow-hidden rounded-sm border border-input", className)}
      style={color && !none ? { backgroundColor: cssColor(color) } : undefined}
    >
      {(none || color === null) && <span className="absolute top-1/2 left-[-20%] h-px w-[140%] -rotate-45 bg-muted-foreground" />}
    </span>
  );
}

function ColorPicker({
  label,
  value,
  onChange,
  swatches,
  allowNone,
}: {
  label: string;
  value: string | null;
  onChange: (color: string) => void;
  swatches: Swatch[];
  allowNone: boolean;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // The native picker needs a "#rrggbb" value; tokens are resolved to what they look like right now.
  const initial = useMemo(() => (value && value !== "none" ? resolveColor(value) : resolveColor("var(--foreground)")), [value]);
  const [custom, setCustom] = useState(initial);

  // Commit once when the picker closes, not on every drag of the hue slider.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const commit = () => onChange(el.value);
    el.addEventListener("change", commit);
    return () => el.removeEventListener("change", commit);
  }, [onChange]);

  return (
    <div className="grid gap-3">
      <div role="group" aria-label={`${label} colours`} className="grid grid-cols-6 gap-1.5">
        {allowNone && (
          <button
            type="button"
            aria-label="None"
            aria-pressed={value === "none"}
            title="None"
            onClick={() => onChange("none")}
            className={cn("grid size-7 place-items-center rounded-md border border-input hover:border-foreground", value === "none" && "ring-2 ring-ring")}
          >
            <Swatch color="none" className="size-5 border-0" />
          </button>
        )}
        {swatches.map((swatch) => (
          <button
            key={swatch.value}
            type="button"
            aria-label={swatch.label}
            aria-pressed={value === swatch.value}
            title={swatch.label}
            onClick={() => onChange(swatch.value)}
            className={cn("size-7 rounded-md border border-input hover:border-foreground", value === swatch.value && "ring-2 ring-ring")}
            style={{ backgroundColor: swatch.value }}
          />
        ))}
      </div>
      <label htmlFor={id} className="flex items-center gap-2 text-xs text-muted-foreground">
        Custom
        <input
          id={id}
          ref={inputRef}
          type="color"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          className="h-7 w-full cursor-pointer rounded-md border border-input bg-background p-0.5"
        />
      </label>
    </div>
  );
}
