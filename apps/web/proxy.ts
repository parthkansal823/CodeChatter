import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

import { appCsp, newNonce } from "@/lib/csp";
import { pageGate } from "@/lib/page-gate";
import { SHOWCASE } from "@/lib/showcase";

/** draw.io's address, as the Diagrams tool has it. */
const DRAWIO_URL = process.env.NEXT_PUBLIC_DRAWIO_URL || "https://embed.diagrams.net";

/**
 * Cheap, optimistic gate: no session cookie means straight to sign-in, with
 * the destination kept in returnTo. The real check happens in the (app)
 * layout and in the API, which validate the session itself.
 *
 * In showcase mode (lib/showcase.ts) there is no app behind the landing page,
 * so its pages, sign-in included, lead back home.
 */
function gate(request: NextRequest): NextResponse | null {
  const kind = pageGate(request.nextUrl.pathname);
  if (kind === "open") return null;
  if (SHOWCASE) return NextResponse.redirect(new URL("/", request.url));
  if (kind === "auth" || getSessionCookie(request, { cookiePrefix: "cc" })) return null;
  const url = new URL("/sign-in", request.url);
  url.searchParams.set("returnTo", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(url);
}

/**
 * Every page also gets its security policy here, with a nonce of its own (lib/csp.ts). Next.js
 * reads the policy from the request's headers and puts the nonce on its scripts; the root
 * layout reads x-nonce for the theme's script.
 */
export function proxy(request: NextRequest) {
  const nonce = newNonce();
  const policy = appCsp({
    nonce,
    dev: process.env.NODE_ENV === "development",
    drawioOrigin: DRAWIO_URL,
    livekitUrl: process.env.LIVEKIT_URL,
  });
  const redirect = gate(request);
  if (redirect) return redirect;
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", policy);
  return response;
}

export const config = {
  // Pages only: not the services behind Caddy, Next's own assets, the preview frame (it has its
  // own policy), the health check, or files with an extension (fonts, schemas, icons).
  matcher: ["/((?!api/|socket\\.io/|ws/|collab|livekit|_next/|frames/|healthz|.*\\.[a-zA-Z0-9]+$).*)"],
};
