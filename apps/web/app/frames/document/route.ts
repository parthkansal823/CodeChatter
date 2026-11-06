import { PREVIEW_FRAME_CSP } from "@/lib/csp";

/**
 * An empty page for the HTML preview (components/room/web-preview.tsx) to run someone's page in.
 *
 * A srcdoc iframe inherits its parent's security policy, which would block the page's own
 * scripts, so the preview needs a document with a policy of its own: this one. It says it's
 * ready, takes one document from the window that framed it, and writes it. The policy's
 * `sandbox` gives it an opaque origin even if someone opens this address directly, and with no
 * parent it does nothing at all.
 */
const PAGE = `<!doctype html><meta charset="utf-8"><title>Preview</title><script>
(function () {
  if (window.parent === window) return;
  function receive(event) {
    if (event.source !== window.parent || !event.data || event.data.__ccDocument !== true || typeof event.data.html !== "string") return;
    window.removeEventListener("message", receive);
    document.open();
    document.write(event.data.html);
    document.close();
  }
  window.addEventListener("message", receive);
  window.parent.postMessage({ __ccFrameReady: true }, "*");
})();
</script>`;

export const dynamic = "force-static";

export function GET() {
  return new Response(PAGE, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": PREVIEW_FRAME_CSP,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "public, max-age=3600",
    },
  });
}
