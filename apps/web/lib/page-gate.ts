/** Which pages the proxy guards. It runs on nearly every page now, for the security policy, so this is what used to be its matcher. */

/** Sign-in and its neighbours: open to everyone, but not part of a showcase. */
const AUTH_PAGES = ["/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/two-factor", "/verify-email"];
/** The signed-in app. */
const APP_PAGES = ["/dashboard", "/new", "/rooms", "/explore", "/automations", "/interviews", "/settings", "/orgs", "/admin"];

const within = (pathname: string, page: string) => pathname === page || pathname.startsWith(`${page}/`);

/** "auth": a sign-in page. "app": needs a session. "open": anyone, such as the landing page or a candidate's link. */
export function pageGate(pathname: string): "auth" | "app" | "open" {
  if (AUTH_PAGES.some((page) => within(pathname, page))) return "auth";
  if (APP_PAGES.some((page) => within(pathname, page))) return "app";
  return "open";
}
