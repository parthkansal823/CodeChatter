/** Hide admin pages before the shared sign-in redirect, including stale session cookies, using the API's fresh instance-authority check. */
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

export async function adminPageGate(request: NextRequest, headers: Headers): Promise<NextResponse | null> {
  const path = request.nextUrl.pathname;
  if (path !== "/admin" && !path.startsWith("/admin/")) return null;
  if (getSessionCookie(request, { cookiePrefix: "cc" })) {
    try {
      const response = await fetch(`${process.env.API_INTERNAL_URL ?? "http://localhost:4000"}/api/admin/access`, {
        headers: { cookie: request.headers.get("cookie") ?? "" },
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000),
      });
      if (response.status === 200) return null;
    } catch { /* No authoritative permission means no admin page. */ }
  }
  // /404 is an unmatched public URL: Next renders the existing root not-found
  // page without entering the signed-in layout. Preserve the requested address.
  return NextResponse.rewrite(new URL("/404", request.url), { status: 404, request: { headers }, headers: { "cache-control": "private, no-store" } });
}
