import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

import { SHOWCASE } from "@/lib/showcase";

/** Sign-in and its neighbours: open to everyone, but not part of a showcase. */
const AUTH_PAGES = ["/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/two-factor", "/verify-email"];

/**
 * Cheap, optimistic gate: no session cookie means straight to sign-in, with
 * the destination kept in returnTo. The real check happens in the (app)
 * layout and in the API, which validate the session itself.
 *
 * In showcase mode (lib/showcase.ts) there is no app behind the landing page,
 * so its pages, sign-in included, lead back home.
 */
export function proxy(request: NextRequest) {
  if (SHOWCASE) return NextResponse.redirect(new URL("/", request.url));
  if (AUTH_PAGES.some((page) => request.nextUrl.pathname.startsWith(page))) return NextResponse.next();
  if (getSessionCookie(request, { cookiePrefix: "cc" })) return NextResponse.next();
  const url = new URL("/sign-in", request.url);
  url.searchParams.set("returnTo", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/rooms/:path*",
    "/explore/:path*",
    "/automations/:path*",
    "/interviews/:path*",
    "/settings/:path*",
    "/orgs/:path*",
    "/admin/:path*",
    "/sign-in",
    "/sign-up",
    "/forgot-password",
    "/reset-password",
    "/two-factor",
    "/verify-email",
  ],
};
