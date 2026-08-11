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
      {/* Rounded tile with a chat tail cut into the lower-left corner. */}
      <path
        d="M6 2h20a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H13l-7 5.5V24a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4Z"
        fill={tile}
      />
      <g
        stroke={glyph}
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12.5 9.5 8.5 13l4 3.5" />
        <path d="M19.5 9.5 23.5 13l-4 3.5" />
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
