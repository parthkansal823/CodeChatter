import { SCRIPT_FRAME_CSP } from "@/lib/csp";

/**
 * An empty page for API Studio's scripts (components/room/tools/api-studio/script-sandbox.ts) to run in. It takes one script from the window that framed
 * it, runs it in a worker made from a blob (so a loop that never ends can be stopped), and sends back what it said. Its policy allows no network and gives
 * it an opaque origin; the worker shuts every way out as well (script-worker-source.ts). With no parent it does nothing at all.
 */
const PAGE = `<!doctype html><meta charset="utf-8"><title>Script</title><script>
(function () {
  if (window.parent === window) return;
  function reply(id, result) {
    window.parent.postMessage({ __ccScriptResult: true, id: id, result: result }, "*");
  }
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (event.source !== window.parent || !data || data.__ccScript !== true || typeof data.source !== "string") return;
    var finished = false;
    var worker = null;
    var url = URL.createObjectURL(new Blob([data.source], { type: "text/javascript" }));
    function finish(result) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (worker) worker.terminate();
      URL.revokeObjectURL(url);
      reply(data.id, result);
    }
    var timer = setTimeout(function () {
      finish({ timedOut: true });
    }, Math.min(Math.max(Number(data.timeoutMs) || 5000, 100), 30000));
    try {
      worker = new Worker(url);
    } catch (error) {
      finish({ failed: String(error && error.message || error) });
      return;
    }
    worker.onmessage = function (message) {
      finish(message.data);
    };
    worker.onerror = function (error) {
      error.preventDefault();
      finish({ failed: String(error.message || "The script couldn't run."), line: error.lineno || null });
    };
    worker.postMessage(data.input);
  });
  window.parent.postMessage({ __ccScriptReady: true }, "*");
})();
</script>`;

export const dynamic = "force-static";

export function GET() {
  return new Response(PAGE, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": SCRIPT_FRAME_CSP,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "public, max-age=3600",
    },
  });
}
