/** Close raw Better Auth admin HTTP routes so unaudited role changes, session-token lists and impersonation cannot bypass the instance controls. */
import type { Auth } from "@codechatter/auth";

export function isRawAdminPath(pathname: string): boolean {
  let path = pathname;
  try {
    for (let i = 0; i < 3; i++) {
      const decoded = decodeURIComponent(path);
      if (decoded === path) break;
      path = decoded;
    }
  } catch { return true; }
  return /^\/api\/auth\/admin(?:\/|$)/i.test(path.replaceAll("\\", "/").replace(/\/+/g, "/"));
}

/** Constructed before main.ts passes the writable handler to toNodeHandler. */
export function blockRawAdminHttp(auth: Auth): void {
  const handler = auth.handler;
  auth.handler = async (request) => isRawAdminPath(new URL(request.url).pathname)
    ? new Response("Not Found", { status: 404, headers: { "cache-control": "no-store" } })
    : handler(request);
}
