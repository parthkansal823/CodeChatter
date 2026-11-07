import localFont from "next/font/local";

// Self-hosted through next/font: no layout shift, no third-party request. Only
// Mona Sans is preloaded, because it's what the first paint needs: the others cost
// a slow connection more than a brief swap in a code block costs anyone. Mona Sans
// is variable on weight (200–900) and width (75–125%). It has no italic file on
// purpose: at 100 KB, for the few places that use it, the browser's slant will do.
export const mona = localFont({
  variable: "--font-mona",
  display: "swap",
  src: [
    { path: "../node_modules/@fontsource-variable/mona-sans/files/mona-sans-latin-standard-normal.woff2", style: "normal" },
  ],
  weight: "200 900",
  declarations: [{ prop: "font-stretch", value: "75% 125%" }],
});

// Monaspace: one metric-compatible superfamily, three voices.
export const neon = localFont({
  variable: "--font-neon",
  display: "swap",
  preload: false,
  src: [
    { path: "../node_modules/@fontsource/monaspace-neon/files/monaspace-neon-latin-400-normal.woff2", weight: "400" },
    { path: "../node_modules/@fontsource/monaspace-neon/files/monaspace-neon-latin-500-normal.woff2", weight: "500" },
    { path: "../node_modules/@fontsource/monaspace-neon/files/monaspace-neon-latin-600-normal.woff2", weight: "600" },
  ],
});

/** AI and agent-written text. */
export const krypton = localFont({
  variable: "--font-krypton",
  display: "swap",
  preload: false,
  src: [{ path: "../node_modules/@fontsource/monaspace-krypton/files/monaspace-krypton-latin-400-normal.woff2", weight: "400" }],
});

/** Review comments and annotations. */
export const radon = localFont({
  variable: "--font-radon",
  display: "swap",
  preload: false,
  src: [{ path: "../node_modules/@fontsource/monaspace-radon/files/monaspace-radon-latin-400-normal.woff2", weight: "400" }],
});
