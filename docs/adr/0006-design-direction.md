# ADR 0006: Design direction is pure black and white, one orange, and people in colour

- **Status:** Accepted (2026-09-24). Revised the same day to follow the owner's explicit brief.
- **Tokens:** `apps/web/app/globals.css`

## Brief (owner's words)

"Make it totally unique and the best. Pure black and white. Modern, premium, simple UI. Add a bit of an orangish colour."

The first token pass was rejected because it was the stock shadcn/Vercel look (Geist, zinc and a blue accent). A second pass, which was graphite with no brand accent, was superseded by the brief above. Where the owner names a direction, it wins.

## Decision

| Axis | Choice |
|---|---|
| Neutrals | True greys with zero chroma. Light theme: `#FFFFFF` background and `#0A0A0A` ink. Dark theme: `#000000` background and `#F5F5F5` text. Hairlines are `#E8E8E8` in light and white at 10% in dark. |
| Primary action | **Ink**: black buttons on light, white buttons on dark. |
| Accent | One **international orange** (`oklch(0.68 0.21 42)` ≈ `#FF5E1A`, lifted to about `#FF7A33` on black). It is used sparingly: the brand mark, focus rings, active indicators, the Run action and **you** (`--me`: your caret, selection and avatar ring). Text on orange is always black, because white on orange fails WCAG. |
| People | Other collaborators get presence hues on their carets, name flags and 2px **presence threads** (git-graph-like lines on the file rows, tabs, messages and dashboard rows they touch), and nowhere else. The hues avoid pure red and green, so a person never reads as an error or a success state. |
| Type | **Mona Sans** variable, with weight 200–900 and width 75–125%. UI text uses it at normal width, and display type is set wide (`font-wide`). **Monaspace** is used for code, and its styles mark authorship: **Neon** for people, **Krypton** for AI or agent output, and **Radon** for review comments. |
| Motion | One orchestrated moment: the landing headline is typed live by named carets. Otherwise, motion only answers an action, over 120–160 ms. Reduced motion is honoured. |
| Structure | No card grids and no ALL-CAPS eyebrows. No `→` suffixes, middle-dot meta strings, or ornamental numbering. The dashboard is a dense live table. Chat uses author-coloured rules instead of bubbles. |

## Accessibility

| Element | Guarantee |
|---|---|
| Body text | 15:1 or better in both themes |
| Muted text | at least 5:1 |
| Carets and threads | at least 3:1 against the background |
| Name flags | pair a `--p-N-soft` fill with black text |
| Focus rings | orange, 2px, with an offset. Visible on both white and black. |
