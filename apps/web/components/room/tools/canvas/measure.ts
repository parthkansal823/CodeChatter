"use client";

import { Atom } from "./atom";
import type { Font, FontFamily, Measure } from "./text-layout";

/** The CSS font-family stacks the canvas draws with (next/font sets the variables on <html>). */
export function fontStacks(): Record<FontFamily, string> {
  const style = getComputedStyle(document.documentElement);
  const mona = style.getPropertyValue("--font-mona").trim();
  const radon = style.getPropertyValue("--font-radon").trim();
  return {
    sans: [mona, "ui-sans-serif", "system-ui", "sans-serif"].filter(Boolean).join(", "),
    note: [radon, "ui-monospace", "monospace"].filter(Boolean).join(", "),
  };
}

function createMeasure(): Measure {
  const context = document.createElement("canvas").getContext("2d");
  const stacks = fontStacks();
  const cache = new Map<string, number>();
  return (text: string, font: Font) => {
    const key = `${font.family}|${font.weight}|${font.size}|${text}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    if (!context) return text.length * font.size * 0.55;
    context.font = `${font.weight} ${font.size}px ${stacks[font.family]}`;
    const width = context.measureText(text).width;
    if (cache.size > 5000) cache.clear();
    cache.set(key, width);
    return width;
  };
}

/**
 * Text measuring, as an atom: when a web font finishes loading, measurements
 * change, so the atom gets a fresh measure function and every text shape that
 * reads it lays itself out again.
 */
export const measureAtom = new Atom<Measure>((text, font) => text.length * font.size * 0.55);

let started = false;

export function startMeasuring() {
  if (started || typeof document === "undefined") return;
  started = true;
  measureAtom.set(createMeasure());
  document.fonts?.addEventListener("loadingdone", () => measureAtom.set(createMeasure()));
  // Radon (sticky notes) isn't preloaded; ask for it so notes don't reflow late.
  void document.fonts?.load(`16px ${fontStacks().note}`).catch(() => undefined);
}

/** A stable measure for code outside React (the editor's text layout). */
export const measureText: Measure = (text, font) => measureAtom.get()(text, font);
