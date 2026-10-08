import type { HttpMethod } from "@codechatter/contracts";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

/** Status meaning, the only colour besides presence: 2xx fine, 3xx informational, 4xx warning, 5xx error. */
export function statusTone(status: number): string {
  if (status >= 500) return "text-destructive";
  if (status >= 400) return "text-warning";
  if (status >= 300) return "text-muted-foreground";
  return "text-success";
}

/** A short label for the collection tree, where a row is only a few characters wide. */
export function methodLabel(method: HttpMethod, protocol: "http" | "ws" | "sse" = "http"): string {
  if (protocol === "ws") return "WS";
  if (protocol === "sse") return "SSE";
  return method === "DELETE" ? "DEL" : method === "OPTIONS" ? "OPT" : method;
}

export function methodTone(method: HttpMethod): string {
  if (method === "DELETE") return "text-destructive";
  return method === "GET" || method === "HEAD" || method === "OPTIONS" ? "text-muted-foreground" : "text-foreground";
}

/** The path and host of a URL typed with {{variables}}, for lists where the full URL is too long. */
export function shortUrl(url: string): string {
  const trimmed = url.trim().replace(/^https?:\/\//i, "");
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
}

export function downloadText(name: string, text: string, type = "application/json"): void {
  const link = document.createElement("a");
  const url = URL.createObjectURL(new Blob([text], { type }));
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
