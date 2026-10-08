/**
 * Which browser origins may talk to the API, the collab server and the
 * socket gateway. One policy for all three, so they can't disagree.
 *
 *  - Always: APP_URL, plus any EXTRA_ORIGINS (comma-separated).
 *  - Development only: the same port on a private-network address
 *    (192.168.x.x, 10.x.x.x, 172.16–31.x.x) or *.local, so a phone or second
 *    laptop on the same Wi-Fi can open http://<this-pc-ip>:8080.
 */
export interface OriginPolicy {
  isAllowed(origin: string | null | undefined): boolean;
  /** Every origin allowed for this request (for Better Auth's trustedOrigins). */
  trustedFor(origin: string | null | undefined): string[];
}

function isPrivateHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".local")) return true;
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function createOriginPolicy(options: { appUrl: string; extraOrigins?: string; allowPrivateNetwork: boolean }): OriginPolicy {
  const app = new URL(options.appUrl);
  const fixed = new Set(
    [app.origin, ...(options.extraOrigins ?? "").split(",")]
      .map((o) => o.trim())
      .filter(Boolean)
      .map((o) => new URL(o).origin),
  );

  const isAllowed = (origin: string | null | undefined) => {
    if (!origin) return false;
    if (fixed.has(origin)) return true;
    if (!options.allowPrivateNetwork) return false;
    try {
      const url = new URL(origin);
      return (url.protocol === "http:" || url.protocol === "https:") && url.port === app.port && isPrivateHost(url.hostname);
    } catch {
      return false;
    }
  };

  return {
    isAllowed,
    trustedFor: (origin) => [...fixed, ...(origin && isAllowed(origin) && !fixed.has(origin) ? [origin] : [])],
  };
}
