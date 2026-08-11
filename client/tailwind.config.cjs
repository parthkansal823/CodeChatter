/** @type {import('tailwindcss').Config} */

/*
 * Design tokens.
 *
 * The app previously used 15 unrelated accent families (violet, amber, emerald,
 * rose, cyan, sky, indigo, purple, pink, teal, ...) across ~1,100 usages, which
 * is what made it read as unfinished. The palette below is deliberately narrow:
 *
 *   brand    the single decorative/primary accent — the only "loud" colour
 *   success  positive state only (connected, saved, passed)
 *   warning  attention state only (pending, unsaved, degraded)
 *   danger   destructive/error state only
 *   info     neutral-informational state only
 *
 * The four semantic ramps are desaturated relative to stock Tailwind so that
 * brand always stays the most prominent hue on screen and status colours read
 * as status rather than decoration.
 */
module.exports = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          '"Fira Code"',
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },

      colors: {
        // ── Primary accent ───────────────────────────────────────────────
        // VS Code's focus/selection blue rather than a saturated indigo.
        // Editors want an accent that recedes: it marks focus and selection
        // without competing with syntax highlighting.
        brand: {
          50: "#eff6fc",
          100: "#cfe4f7",
          200: "#9ecbef",
          300: "#6cb0e6",
          400: "#3794d8",
          500: "#0078d4",
          600: "#0067b8",
          700: "#005a9e",
          800: "#004578",
          900: "#003356",
          950: "#002138",
        },

        // ── Semantic: positive ───────────────────────────────────────────
        success: {
          50: "#ecfdf5",
          100: "#d1fae5",
          200: "#a7f3d0",
          300: "#6ee7b7",
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
          800: "#065f46",
          900: "#064e3b",
          950: "#022c22",
        },

        // ── Semantic: attention ──────────────────────────────────────────
        warning: {
          50: "#fffbeb",
          100: "#fef3c7",
          200: "#fde68a",
          300: "#fcd34d",
          400: "#fbbf24",
          500: "#f59e0b",
          600: "#d97706",
          700: "#b45309",
          800: "#92400e",
          900: "#78350f",
          950: "#451a03",
        },

        // ── Semantic: destructive ────────────────────────────────────────
        danger: {
          50: "#fef2f2",
          100: "#fee2e2",
          200: "#fecaca",
          300: "#fca5a5",
          400: "#f87171",
          500: "#ef4444",
          600: "#dc2626",
          700: "#b91c1c",
          800: "#991b1b",
          900: "#7f1d1d",
          950: "#450a0a",
        },

        // ── Semantic: informational ──────────────────────────────────────
        info: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
          950: "#172554",
        },

        // ── Editor chrome surfaces (VS Code Dark+ / Light+) ──────────────
        // A flat, four-step ramp. Depth comes from these steps plus 1px
        // borders — not from shadows or translucency.
        editor: {
          // dark
          bg: "#1e1e1e", // editor canvas
          side: "#252526", // sidebar / panels
          bar: "#333333", // activity bar / title bar
          input: "#3c3c3c", // inputs, dropdowns
          line: "#2b2b2b", // hairline separators
          edge: "#454545", // stronger dividers, focus outlines
          hover: "#2a2d2e", // row hover
          active: "#37373d", // selected row
          sel: "#264f78", // text selection
          // light
          "l-bg": "#ffffff",
          "l-side": "#f3f3f3",
          "l-bar": "#f8f8f8",
          "l-input": "#ffffff",
          "l-line": "#e5e5e5",
          "l-edge": "#d4d4d4",
          "l-hover": "#e8e8e8",
          "l-active": "#e4e6f1",
        },

        surface: {
          light: "#ffffff",
          subtle: "#f3f3f3",
          dark: "#1e1e1e",
          darker: "#181818",
        },

        // ── Bridge to src/styles/theme.css ───────────────────────────────
        // These aliases resolve to the CSS custom properties defined there, so
        // `bg-canvas` / `text-fg` / `border-subtle` follow the active theme
        // automatically — no `dark:` variant needed. Prefer these in new code;
        // the zinc/brand scales above remain for the not-yet-migrated screens.
        canvas: "var(--bg-canvas)",
        panel: "var(--bg-panel)",
        chrome: "var(--bg-chrome)",
        field: "var(--bg-input)",
        hovered: "var(--bg-hover)",
        selected: "var(--bg-active)",
        overlay: "var(--bg-overlay)",

        fg: {
          DEFAULT: "var(--fg-default)",
          muted: "var(--fg-muted)",
          subtle: "var(--fg-subtle)",
          accent: "var(--accent-fg)",
        },

        edge: {
          subtle: "var(--border-subtle)",
          DEFAULT: "var(--border-default)",
          strong: "var(--border-strong)",
        },

        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          active: "var(--accent-active)",
          subtle: "var(--accent-subtle)",
        },
      },

      // VS Code's UI type scale: 13px base, 12px for tree/list rows, 11px for
      // badges and status text. Small and dense — an editor shows a lot at once.
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.01em" }],
        xs: ["0.75rem", { lineHeight: "1.125rem" }],
        sm: ["0.8125rem", { lineHeight: "1.25rem" }],
        base: ["0.8125rem", { lineHeight: "1.375rem" }],
        lg: ["0.9375rem", { lineHeight: "1.5rem" }],
        xl: ["1.125rem", { lineHeight: "1.75rem", letterSpacing: "-0.01em" }],
        "2xl": ["1.375rem", { lineHeight: "1.875rem", letterSpacing: "-0.015em" }],
        "3xl": ["1.75rem", { lineHeight: "2.125rem", letterSpacing: "-0.02em" }],
        "4xl": ["2.25rem", { lineHeight: "2.5rem", letterSpacing: "-0.025em" }],
        "5xl": ["3rem", { lineHeight: "1.1", letterSpacing: "-0.03em" }],
        "6xl": ["3.75rem", { lineHeight: "1.05", letterSpacing: "-0.035em" }],
        "7xl": ["4.5rem", { lineHeight: "1", letterSpacing: "-0.04em" }],
      },

      // Editor-grade radii. VS Code is nearly square: 2px on controls, 4-6px
      // on floating surfaces. Everything below `xl` is deliberately tiny —
      // large radii are what made this read as a marketing site, not a tool.
      borderRadius: {
        none: "0",
        DEFAULT: "3px",
        sm: "2px",
        md: "3px",
        lg: "4px",
        xl: "6px",
        "2xl": "6px",
        "3xl": "8px",
        full: "9999px",
      },

      // Elevation is reserved for surfaces that genuinely float above the
      // page (menus, dialogs, autocomplete). Inline cards use a 1px border.
      boxShadow: {
        none: "none",
        xs: "none",
        sm: "none",
        DEFAULT: "none",
        md: "0 2px 8px rgb(0 0 0 / 0.16)",
        lg: "0 4px 16px rgb(0 0 0 / 0.24)",
        xl: "0 8px 32px rgb(0 0 0 / 0.32)",
        panel: "0 2px 8px rgb(0 0 0 / 0.16)",
      },

      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.24s cubic-bezier(0.16, 1, 0.3, 1)",
        shimmer: "shimmer 1.6s linear infinite",
        "loading-sweep": "loadingSweep 1.1s cubic-bezier(0.4, 0, 0.2, 1) infinite",
      },

      keyframes: {
        loadingSweep: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(400%)" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
