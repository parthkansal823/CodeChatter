/**
 * Showcase mode: the landing page on its own, with no app behind it (on Vercel's free plan,
 * say), for people who'd like to see CodeChatter before running it. Its buttons open the demo
 * video, the code, and how to run it, instead of signing in; the app's pages lead back home.
 *
 * Decided at build time (next build inlines NEXT_PUBLIC_*): NEXT_PUBLIC_SHOWCASE=1, with
 * NEXT_PUBLIC_REPO_URL and, when there is one, NEXT_PUBLIC_DEMO_VIDEO_URL. See docs/deploy.md.
 */
export const SHOWCASE = process.env.NEXT_PUBLIC_SHOWCASE === "1";
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? "";
export const DEMO_VIDEO_URL = process.env.NEXT_PUBLIC_DEMO_VIDEO_URL ?? "";
/** The README's section on running it. */
export const RUN_IT_URL = REPO_URL ? `${REPO_URL.replace(/\/$/, "")}#run-it-locally` : "";
