import "server-only";

import { cookies } from "next/headers";

const API = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

/**
 * Server Components reach the API directly (not through Caddy), forwarding
 * the visitor's cookies so the API sees the same session the browser has.
 * Returns null on 401 so callers can redirect to sign-in.
 */
export async function serverApi<T>(path: `/api/${string}`, init: RequestInit = {}): Promise<T | null> {
  const cookieHeader = (await cookies()).toString();
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { accept: "application/json", ...(cookieHeader && { cookie: cookieHeader }), ...init.headers },
    cache: "no-store",
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`API ${path} failed: ${response.status}`);
  return (await response.json()) as T;
}

/** Like serverApi, but hands back the status instead of throwing on 4xx. */
export async function serverApiResult<T>(
  path: `/api/${string}`,
  init: RequestInit = {},
): Promise<{ status: number; data: T | null }> {
  const cookieHeader = (await cookies()).toString();
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(cookieHeader && { cookie: cookieHeader }),
      ...init.headers,
    },
    cache: "no-store",
  });
  const data = response.ok && response.status !== 204 ? ((await response.json()) as T) : null;
  return { status: response.status, data };
}

export type ServerMeta ={ auth: { emailPassword: boolean; google: boolean; github: boolean } };

export async function getMeta(): Promise<ServerMeta> {
  try {
    return (await serverApi<ServerMeta>("/api/meta")) ?? { auth: { emailPassword: true, google: false, github: false } };
  } catch {
    // API unreachable: still render email sign-in; the submit will surface the error.
    return { auth: { emailPassword: true, google: false, github: false } };
  }
}
