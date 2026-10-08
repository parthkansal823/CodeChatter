/** Minimal structured-ish logging, one line per event (the runner has few, rare logs). */
const stamp = () => new Date().toISOString().slice(11, 23);

export const log = {
  info: (message: string) => console.log(`[runner ${stamp()}] ${message}`),
  warn: (message: string) => console.warn(`[runner ${stamp()}] warn: ${message}`),
  error: (message: string, error?: unknown) =>
    console.error(`[runner ${stamp()}] error: ${message}${error ? `: ${error instanceof Error ? error.message : String(error)}` : ""}`),
};
