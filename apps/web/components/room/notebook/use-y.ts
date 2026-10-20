"use client";

import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

/** A Y.Map, Y.Array or Y.Text: anything with Yjs's observe. */
type Observable = { observe(handler: () => void): void; unobserve(handler: () => void): void };

/**
 * `read()` again whenever one of `types` changes (each observed shallowly). The result
 * is a fresh value per change, so nothing downstream (React's compiler included) keeps
 * a stale one: the same tick-and-memo pattern as useFileTree.
 */
export function useYSnapshot<T>(types: ReadonlyArray<Observable | null | undefined>, read: () => T): T {
  const version = useRef(0);
  const key = types.length;
  const [a, b, c] = types;
  const subscribe = useCallback(
    (onChange: () => void) => {
      const handler = () => {
        version.current += 1;
        onChange();
      };
      const observed = [a, b, c].filter((type): type is Observable => Boolean(type));
      for (const type of observed) type.observe(handler);
      return () => {
        for (const type of observed) type.unobserve(handler);
      };
    },
    // Up to three types: enough for a notebook, a cell and its outputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [a, b, c, key],
  );
  const tick = useSyncExternalStore(subscribe, () => version.current, () => 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => read(), [tick, read]);
}
