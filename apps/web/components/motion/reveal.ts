// Plain class strings and helpers for scroll-in animations. Deliberately not a
// client module: Server Components call these while rendering. The trigger is
// <InView> (components/motion/in-view.tsx), which sets data-inview on a group.

/** One staggered item rising into place; pass `delay(ms)` as its style. */
export const reveal =
  "reveal opacity-0 translate-y-2 transition duration-500 ease-out group-data-[inview=true]/iv:opacity-100 group-data-[inview=true]/iv:translate-y-0";
/** Same, arriving from above (live feeds, newest first). */
export const revealDown =
  "reveal opacity-0 -translate-y-2 transition duration-500 ease-out group-data-[inview=true]/iv:opacity-100 group-data-[inview=true]/iv:translate-y-0";
/** A connector drawing itself left to right. */
export const growX =
  "reveal origin-left scale-x-0 transition-transform duration-500 ease-out group-data-[inview=true]/iv:scale-x-100";
/** A thread growing up from its baseline. */
export const growY =
  "reveal origin-bottom scale-y-0 transition-transform duration-500 ease-out group-data-[inview=true]/iv:scale-y-100";

export const delay = (ms: number) => ({ transitionDelay: `${ms}ms` });
