/**
 * Colours people pick from start as design tokens: the value stored on a
 * shape is the token reference ("var(--p-2)"), so a design follows the
 * app's light and dark themes and exports resolve it to a concrete colour.
 * A custom colour from the picker is stored as the user typed it.
 */
export type Swatch = { value: string; label: string };

export const INK = "var(--foreground)";
export const PAPER = "var(--background)";

export const DESIGN_SWATCHES: Swatch[] = [
  { value: "var(--foreground)", label: "Ink" },
  { value: "var(--muted-foreground)", label: "Grey" },
  { value: "var(--input)", label: "Light grey" },
  { value: "var(--muted)", label: "Mist" },
  { value: "var(--background)", label: "Paper" },
  { value: "var(--brand)", label: "Brand orange" },
  { value: "var(--p-2)", label: "Iris" },
  { value: "var(--p-3)", label: "Sky" },
  { value: "var(--p-4)", label: "Teal" },
  { value: "var(--p-5)", label: "Chartreuse" },
  { value: "var(--p-6)", label: "Rose" },
  { value: "var(--p-7)", label: "Orchid" },
  { value: "var(--p-8)", label: "Gold" },
  { value: "var(--p-1-soft)", label: "Soft orange" },
  { value: "var(--p-2-soft)", label: "Soft iris" },
  { value: "var(--p-3-soft)", label: "Soft sky" },
  { value: "var(--p-4-soft)", label: "Soft teal" },
  { value: "var(--p-5-soft)", label: "Soft chartreuse" },
  { value: "var(--p-6-soft)", label: "Soft rose" },
  { value: "var(--p-7-soft)", label: "Soft orchid" },
  { value: "var(--p-8-soft)", label: "Soft gold" },
  { value: "var(--success)", label: "Success" },
  { value: "var(--warning)", label: "Warning" },
  { value: "var(--destructive)", label: "Danger" },
];

/** Sticky note colours: the soft hues, which always carry black text. */
export const NOTE_SWATCHES: Swatch[] = [
  { value: "var(--p-8-soft)", label: "Yellow" },
  { value: "var(--p-1-soft)", label: "Orange" },
  { value: "var(--p-6-soft)", label: "Pink" },
  { value: "var(--p-7-soft)", label: "Purple" },
  { value: "var(--p-3-soft)", label: "Blue" },
  { value: "var(--p-5-soft)", label: "Green" },
];

/** Pen and shape colours on a whiteboard. */
export const INK_SWATCHES: Swatch[] = [
  { value: "var(--foreground)", label: "Ink" },
  { value: "var(--brand)", label: "Orange" },
  { value: "var(--p-2)", label: "Iris" },
  { value: "var(--p-3)", label: "Sky" },
  { value: "var(--p-5)", label: "Green" },
  { value: "var(--p-6)", label: "Rose" },
];

const LABELS = new Map([...DESIGN_SWATCHES, ...NOTE_SWATCHES, ...INK_SWATCHES].map((s) => [s.value, s.label]));

export function colorLabel(value: string): string {
  if (!value || value === "none") return "None";
  return LABELS.get(value) ?? value;
}

/** A colour value as CSS for swatches in the UI ("none" draws nothing). */
export const cssColor = (value: string) => (value === "none" ? "transparent" : value);
