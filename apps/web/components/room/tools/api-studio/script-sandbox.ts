/**
 * Runs one of API Studio's scripts (scripts.ts) where it can't reach anything: a hidden frame of /frames/script, with an opaque origin and no network,
 * runs it in a worker it stops after five seconds. Only the frame's own answers are listened to.
 */
import { readResult, type ScriptInput, type ScriptResult } from "./scripts";
import { workerSource } from "./script-worker-source";

const SECONDS = 5;

export function runScript(code: string, input: ScriptInput): Promise<ScriptResult> {
  const { source, userLine } = workerSource(code);
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.title = "Script";
    frame.hidden = true;
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.src = "/frames/script";
    let settled = false;
    const settle = (result: ScriptResult) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      frame.remove();
      resolve(result);
    };
    // The frame stops the worker itself; this is for a frame that never answers at all.
    const timer = setTimeout(() => settle({ tests: [], logs: [], variables: {}, error: "The script couldn't start. Reload the page and try again." }), (SECONDS + 10) * 1000);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return;
      const data = event.data as { __ccScriptReady?: boolean; __ccScriptResult?: boolean; id?: string; result?: unknown } | null;
      if (data?.__ccScriptReady) frame.contentWindow?.postMessage({ __ccScript: true, id, source, input, timeoutMs: SECONDS * 1000 }, "*");
      else if (data?.__ccScriptResult && data.id === id) settle(readResult(data.result, userLine));
    };
    window.addEventListener("message", onMessage);
    document.body.appendChild(frame);
  });
}
