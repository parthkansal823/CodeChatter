/** Files with a live preview beside the code or on their own: Markdown, tables, SVG images and Mermaid diagrams. */
export type PreviewKind = "markdown" | "table" | "image" | "diagram";

export function previewKindOf(name: string): PreviewKind | null {
  if (/\.(md|markdown)$/i.test(name)) return "markdown";
  if (/\.(csv|tsv)$/i.test(name)) return "table";
  if (/\.svg$/i.test(name)) return "image";
  if (/\.(mmd|mermaid)$/i.test(name)) return "diagram";
  return null;
}

/** What the tab bar's button and the palette call each preview. */
export const PREVIEW_LABEL: Record<PreviewKind, string> = {
  markdown: "Markdown preview",
  table: "Table view",
  image: "Image preview",
  diagram: "Diagram preview",
};

/** Read a renderer's error heading so the preview can point back to a line without mistaking quoted source for a location. */
export function mermaidErrorLine(message: string): number | null {
  const heading = message.split(/\r?\n/, 1)[0] ?? "";
  const match = /\bline\s*[:=]?\s*(\d+)\b(?!\.\d)/i.exec(heading);
  const line = Number(match?.[1]);
  return Number.isSafeInteger(line) && line > 0 ? line : null;
}
