import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap, optimistic gate: no session cookie means straight to sign-in, with
 * the destination kept in returnTo. The real check happens in the (app)
 * layout and in the API, which validate the session itself.
 */
export function proxy(request: NextRequest) {
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
  ],
};
