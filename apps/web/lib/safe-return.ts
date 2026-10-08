/**
 * Where to send someone after sign-in. Only same-site paths are allowed:
 * "//evil.com" and "https://evil.com" would turn returnTo into an open
 * redirect. (v1 lost the destination entirely, e.g. invite links.)
 */
export function safeReturnTo(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
