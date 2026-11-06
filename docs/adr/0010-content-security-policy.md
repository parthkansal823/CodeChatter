# ADR 0010: A nonce-based security policy, with previews in a frame of their own

- **Status:** Accepted (2026-11-06).
- **Code:**
  - web: `apps/web/lib/csp.ts`, `apps/web/proxy.ts`, `apps/web/app/layout.tsx`, `apps/web/app/frames/document/route.ts`, `apps/web/components/room/web-preview.tsx`
- **Tests:**
  - unit: `apps/web/lib/csp.test.ts`
  - end to end: `apps/web/test/csp.e2e.mjs`, and every browser suite, because `apps/web/test/browser.mjs` fails a suite on anything the policy refuses

## Context

A room's page shows other people's code, chat, file names and Markdown. React escapes all of that, but a single mistake in rendering it would run one person's script in another person's signed-in session. The page had no Content-Security-Policy to limit the damage.

## Decision

Every page gets a policy with a nonce made for that response, in `proxy.ts`. Scripts need the nonce, or must be loaded by a script that has it (`'strict-dynamic'`). Inline handlers, `javascript:` URLs and plugins don't run, and `eval` is off in production.

- **Pages render per request.** A nonce can't be baked into static HTML, so the root layout reads it from the request. Marketing pages lose static rendering, which is a small cost for a server that already renders the app.
- **Styles keep `'unsafe-inline'`.** Monaco, xterm and the UI kit set styles at runtime. Blocking scripts is what stops an attack from running code. Allowing inline styles leaves some styling tricks open, and that's accepted.
- **Images can come from any `https:` address**, because avatars and the images in a README can be anywhere. A page can therefore still make a request to a foreign address through an image. Scripts can't run to build such a request from secrets, which is the case this policy is for.

### The HTML preview gets its own frame

A `srcdoc` iframe inherits its parent's policy, so the preview's own inline scripts would have stopped working. `/frames/document` is a real address with a policy of its own, which allows those scripts. The preview asks for that page and hands it the HTML with `postMessage`.

What keeps it safe is the `sandbox` in the policy, not just the `sandbox` on the iframe. The browser gives the document an opaque origin however it's reached, even when someone opens the address directly, so it can't read the app, its cookies or its storage.

## Alternatives

- **Putting the nonce on the preview's scripts:** the page's inline handlers would still fail, and it would hand the app's nonce to code we don't control.
- **Hashes instead of nonces:** Next.js's inline scripts change with every response.
- **The preview on a separate domain:** the strongest separation, but it needs another hostname and certificate on every install for something `sandbox` already gives. Dev servers do have their own origin (`preview-proxy.ts`), because they can set cookies and need real URLs.

## Consequences

- A library that needs `eval` in production breaks. Dev mode allows `eval`, so only a production build shows this. The check is to run the browser suites against the built image.
- A new embed (a frame, a script, a WebSocket to another host) has to be added to `lib/csp.ts`. Any browser suite that uses it fails until it is.
- `LIVEKIT_URL` has to reach the web service, so the policy can allow calls when LiveKit isn't on this site's `/livekit`. `NEXT_PUBLIC_DRAWIO_URL` is read at build time, as the Diagrams tool reads it.
