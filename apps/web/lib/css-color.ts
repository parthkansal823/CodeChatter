"use client";

let ctx: CanvasRenderingContext2D | null = null;

/**
 * Resolve a CSS colour (e.g. "var(--brand)" or an oklch() token) to the
 * "#rrggbb" / "#rrggbbaa" form that canvas-based renderers like xterm.js
 * need. The browser paints one pixel with it and we read the bytes back, so
 * any colour syntax the browser understands works and design tokens stay
 * the single source of truth (no colour literals in components).
 */
export function resolveColor(css: string, within: Element = document.documentElement): string {
  const probe = document.createElement("span");
  probe.style.color = css;
  probe.style.display = "none";
  within.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();

  ctx ??= Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
  if (!ctx) return computed;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = computed;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 255] = ctx.getImageData(0, 0, 1, 1).data;
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}${a < 255 ? hex(a) : ""}`;
}

export const cssVar = (name: string, within?: Element) => resolveColor(`var(${name})`, within);
