/** Files with a preview (Ctrl+K V beside the code, Ctrl+Shift+V on its own): Markdown rendered, CSV as a table, SVG as an image. */
export type PreviewKind = "markdown" | "table" | "image";

export function previewKindOf(name: string): PreviewKind | null {
  if (/\.(md|markdown)$/i.test(name)) return "markdown";
  if (/\.(csv|tsv)$/i.test(name)) return "table";
  if (/\.svg$/i.test(name)) return "image";
  return null;
}

/** What the tab bar's button and the palette call each preview. */
export const PREVIEW_LABEL: Record<PreviewKind, string> = {
  markdown: "Markdown preview",
  table: "Table view",
  image: "Image preview",
};
