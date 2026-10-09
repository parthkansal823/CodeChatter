/** Minimal structured-ish logging, one line per event (the runner has few, rare logs). */
const stamp = () => new Date().toISOString().slice(11, 23);

/**
 * An error's message. Some aren't Errors (a WebSocket's error event, from the
 * Kubernetes client); their message is enough, and the rest of them can hold
 * the connection's credentials, so they're never printed whole.
 */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : String(error);
}

export const log = {
  info: (message: string) => console.log(`[runner ${stamp()}] ${message}`),
  warn: (message: string) => console.warn(`[runner ${stamp()}] warn: ${message}`),
  error: (message: string, error?: unknown) => console.error(`[runner ${stamp()}] error: ${message}${error ? `: ${messageOf(error)}` : ""}`),
};
