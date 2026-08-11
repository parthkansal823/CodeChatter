/**
 * CodeChatter wordmark.
 *
 * Deliberately flat and monochrome-capable: the previous mark stacked two
 * gradient "bubbles" plus gradient-clipped text, which is the visual signature
 * of a template rather than a product. This one is a single solid tile with a
 * chat tail and code chevrons — it holds up at 16px and prints in one colour.
 *
 * `tone="accent"` (default) paints the tile in the brand accent.
 * `tone="current"` inherits the surrounding text colour, for use on toolbars,
 * inverted surfaces, or anywhere the mark should not shout.
 */
const SIZES = {
  xs: { box: 18, text: "text-sm" },
  sm: { box: 22, text: "text-base" },
  md: { box: 26, text: "text-lg" },
  lg: { box: 32, text: "text-xl" },
  xl: { box: 40, text: "text-2xl" },
};

export function BrandMark({ size = 26, tone = "accent", className = "" }) {
  const tile = tone === "current" ? "currentColor" : "#0078D4";
  const glyph = tone === "current" ? "var(--bg-canvas, #fff)" : "#FFFFFF";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="CodeChatter"
      className={className}
    >
      {/* Squircle tile. The previous mark cut a chat tail out of one corner,
          which turned to mush below ~20px; a plain rounded square holds its
          silhouette in a 16px favicon. */}
      <rect x="1" y="1" width="30" height="30" rx="9" fill={tile} />

      {/* A terminal prompt: chevron plus cursor. One stroke weight, round caps,
          and enough clearance from the tile edge to survive small sizes. */}
      <g
        stroke={glyph}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10.5 11.5 15 16l-4.5 4.5" />
        <path d="M18.5 20.5h3.5" />
      </g>
    </svg>
  );
}

export default function BrandLogo({
  size = "md",
  tone = "accent",
  showText = true,
  className = "",
}) {
  const { box, text } = SIZES[size] || SIZES.md;

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <BrandMark size={box} tone={tone} />
      {showText && (
        <span className={`${text} font-semibold tracking-tight text-fg`}>
          CodeChatter
        </span>
      )}
    </span>
  );
}
