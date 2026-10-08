import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

/**
 * Presence is the only place saturated colour appears besides the brand
 * orange. A person is identified by a hue slot 1–8 (slot 1 is the brand
 * orange and is the default for "you"). See ADR 0006.
 */
export type PresenceSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const presenceVar = (slot: PresenceSlot) => `var(--p-${slot})`;
export const presenceSoftVar = (slot: PresenceSlot) => `var(--p-${slot}-soft)`;

/** Stable slot for a user id, so a person keeps their colour across sessions. */
export function slotFor(userId: string, avoidSlot?: PresenceSlot): PresenceSlot {
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  let slot = ((Math.abs(hash) % 7) + 2) as PresenceSlot; // 2–8: slot 1 is reserved for "you"
  if (slot === avoidSlot) slot = ((slot % 7) + 2) as PresenceSlot;
  return slot;
}

/** A text caret with its owner's name flag, as drawn inside the editor. */
export function Caret({
  name,
  slot,
  blink = false,
  flagSide = "right",
  className,
}: {
  name?: string;
  slot: PresenceSlot;
  blink?: boolean;
  /**
   * Where the name flag sits: above the caret, extending right or left, or
   * "inline" beside it on the same line — for text typed at a line's end,
   * where a flag above would cover the line before.
   */
  flagSide?: "left" | "right" | "inline";
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("relative inline-block h-[1.05em] w-[2px] translate-y-[0.14em] align-baseline", className)}
      style={{ backgroundColor: presenceVar(slot) }}
    >
      {blink && <span className="absolute inset-0 animate-caret bg-inherit" />}
      {name && (
        <span
          className={cn(
            "absolute rounded-[3px] px-1.5 py-px font-sans text-2xs font-medium leading-4 tracking-normal whitespace-nowrap text-black",
            flagSide === "inline"
              ? "top-1/2 left-1.5 -translate-y-1/2"
              : flagSide === "right"
                ? "-top-[1.55em] left-0 rounded-bl-none"
                : "-top-[1.55em] right-0 rounded-br-none",
          )}
          style={{ backgroundColor: presenceSoftVar(slot) }}
        >
          {name}
        </span>
      )}
    </span>
  );
}

/**
 * Presence threads: 2px vertical lines, one per person touching this row.
 * They sit on the leading edge of file rows, tabs, messages and room rows.
 */
export function Threads({ slots, className }: { slots: PresenceSlot[]; className?: string }) {
  if (slots.length === 0) return null;
  return (
    <span aria-hidden="true" className={cn("flex h-full shrink-0 gap-[2px]", className)}>
      {slots.slice(0, 4).map((slot, i) => (
        <span key={`${slot}-${i}`} className="h-full w-thread rounded-full" style={{ backgroundColor: presenceVar(slot) }} />
      ))}
    </span>
  );
}

/** Initials avatar with a presence ring. Images are optional. */
export function PresenceAvatar({
  name,
  slot,
  size = 24,
  image,
  className,
}: {
  name: string;
  slot?: PresenceSlot;
  size?: number;
  image?: string | null;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  const style: CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.max(9, Math.round(size * 0.4)),
    ...(slot && { boxShadow: `0 0 0 2px var(--background), 0 0 0 3.5px ${presenceVar(slot)}` }),
  };
  return (
    <span
      title={name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-medium text-foreground select-none",
        className,
      )}
      style={style}
    >
      {image ? (
        // OAuth avatars come from arbitrary hosts at tiny sizes; next/image would need
        // every host allow-listed for no real saving.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="size-full object-cover" />
      ) : (
        initials || "?"
      )}
    </span>
  );
}
