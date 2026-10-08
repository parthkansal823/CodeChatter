import { cn } from "@/lib/utils";

/**
 * Two carets side by side — one ink, one orange with a name flag. Two people
 * typing in the same place is the whole product, so that is the mark.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={cn("size-5 shrink-0", className)}>
      <rect x="4" y="3" width="2.5" height="14" rx="0.6" className="fill-foreground" />
      <rect x="11.5" y="3" width="2.5" height="14" rx="0.6" className="fill-brand" />
      <rect x="11.5" y="3" width="6" height="4" rx="0.8" className="fill-brand" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-foreground", className)}>
      <LogoMark />
      <span className="font-wide text-[15px] font-semibold tracking-[-0.02em]">codechatter</span>
    </span>
  );
}
