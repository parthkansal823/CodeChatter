/** Keep each preview's last good image and ignore stale work after edits, theme changes or closing. */
"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { imageSizedSvg, renderDiagram, type Drawing } from "./mermaid-renderer";
import { problemOf, type Problem } from "./mermaid-problem";

const lastDrawings = new Map<string, Drawing>();
let cachedCharacters = 0;

function rememberDrawing(key: string, drawing: Drawing) {
  cachedCharacters -= lastDrawings.get(key)?.svg.length ?? 0;
  lastDrawings.delete(key);
  if (drawing.svg.length > 4_000_000) return;
  lastDrawings.set(key, drawing);
  cachedCharacters += drawing.svg.length;
  // Full/side mode remounts the pane. Keep its last good drawing without retaining unbounded SVG data.
  while (lastDrawings.size > 16 || cachedCharacters > 4_000_000) {
    const oldest = lastDrawings.keys().next().value;
    if (oldest === undefined) break;
    cachedCharacters -= lastDrawings.get(oldest)?.svg.length ?? 0;
    lastDrawings.delete(oldest);
  }
}

export function useMermaidDrawing(text: string, enabled = true, cacheKey?: string) {
  const { resolvedTheme } = useTheme();
  const [drawing, setDrawing] = useState<Drawing | null>(() => cacheKey ? lastDrawings.get(cacheKey) ?? null : null);
  const [failure, setFailure] = useState<{ text: string; theme: string | undefined; problem: Problem } | null>(null);
  const problem = failure?.text === text && failure.theme === resolvedTheme ? failure.problem : null;
  const empty = !text.trim();

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    const timer = window.setTimeout(() => {
      if (!text.trim()) return;
      void renderDiagram(text, resolvedTheme === "dark", () => current).then(async (result) => {
        if (!current || !result) return;
        const next = { svg: imageSizedSvg(result.svg), type: result.diagramType };
        const image = new Image();
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(next.svg)}`;
        await image.decode();
        if (!current) return;
        if (cacheKey) rememberDrawing(cacheKey, next);
        setDrawing(next);
        setFailure(null);
      }).catch((error: unknown) => {
        if (current) setFailure({ text, theme: resolvedTheme, problem: problemOf(error, text) });
      });
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [text, resolvedTheme, cacheKey, enabled]);

  return { drawing, problem, empty };
}
