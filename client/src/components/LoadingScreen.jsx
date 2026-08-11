import { BrandMark } from "./BrandLogo";

/**
 * Full-screen loading state, shared by the route-level Suspense fallback and by
 * the room shell.
 *
 * It paints from theme tokens rather than a fixed colour. The previous fallback
 * was hardcoded `bg-black`, which meant every lazy route flashed a black panel
 * before the page rendered — jarring in the light theme, and a visible seam in
 * the dark one too because the canvas is #1e1e1e, not black.
 *
 * The mark holds still and only the track under it animates: a spinner that
 * appears for 150ms reads as a glitch, a calm bar does not.
 */
export default function LoadingScreen({ label = "Loading" }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-screen w-full flex-col items-center justify-center gap-5 bg-canvas text-fg"
    >
      <BrandMark size={40} />

      <div className="flex flex-col items-center gap-3">
        <p className="text-sm text-fg-muted">{label}</p>

        {/* Indeterminate track — width and position animate, so it works
            without knowing how much is left. */}
        <div className="h-0.5 w-32 overflow-hidden rounded-full bg-hovered">
          <div className="h-full w-1/3 animate-loading-sweep rounded-full bg-accent" />
        </div>
      </div>
    </div>
  );
}
