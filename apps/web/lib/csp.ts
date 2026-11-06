/**
 * The app's Content-Security-Policy. A page shows other people's code, chat and Markdown, so
 * this is the backstop if any of it ever gets through as HTML: only scripts carrying this
 * request's nonce (and what they load) run, and inline handlers and javascript: URLs don't.
 * Styles stay 'unsafe-inline', because Monaco, xterm and the UI kit set them at runtime.
 */

export type CspInput = {
  nonce: string;
  /** Next's dev server needs eval. Production never gets it. */
  dev: boolean;
  /** draw.io's origin, for the Diagrams tool. */
  drawioOrigin?: string | null;
  /** LIVEKIT_URL, when calls go somewhere other than this site's /livekit. */
  livekitUrl?: string | null;
};

const originOf = (url: string | null | undefined): URL | null => {
  try {
    return url ? new URL(url) : null;
  } catch {
    return null;
  }
};

/** LiveKit's client signals over WebSocket, and asks the same host over HTTP for regions. */
function livekitSources(url: string | null | undefined): string[] {
  const parsed = originOf(url);
  if (!parsed) return [];
  const secure = parsed.protocol === "wss:" || parsed.protocol === "https:";
  return [`${secure ? "wss" : "ws"}://${parsed.host}`, `${secure ? "https" : "http"}://${parsed.host}`];
}

export function appCsp({ nonce, dev, drawioOrigin, livekitUrl }: CspInput): string {
  const drawio = originOf(drawioOrigin)?.origin;
  const directives: Array<[string, ...string[]]> = [
    ["default-src", "'self'"],
    // 'strict-dynamic' lets the nonced bootstrap load the app's chunks, which have no nonce of their own.
    ["script-src", "'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    ["style-src", "'self'", "'unsafe-inline'"],
    // https: because avatars and the images in a README can be anywhere.
    ["img-src", "'self'", "data:", "blob:", "https:"],
    ["font-src", "'self'", "data:"],
    ["media-src", "'self'", "blob:"],
    // 'self' covers this site's WebSockets too: collab, Socket.IO, terminals, language servers.
    ["connect-src", "'self'", "blob:", "data:", ...livekitSources(livekitUrl)],
    ["worker-src", "'self'", "blob:"],
    // blob: for the PDF viewer. A blob: document inherits this policy, so it can't run scripts either.
    ["frame-src", "'self'", "blob:", ...(drawio ? [drawio] : [])],
    ["frame-ancestors", "'self'"],
    ["object-src", "'none'"],
    ["base-uri", "'none'"],
    ["form-action", "'self'"],
  ];
  return directives.map((directive) => directive.join(" ")).join("; ");
}

/**
 * The policy of /frames/document, where the HTML preview runs someone's own page. Their inline
 * scripts have to work, so it allows nearly everything; what keeps it safe is `sandbox`. The
 * browser gives the document an opaque origin however it's reached, so it can't read this site
 * or use its cookies, even if someone opens the address directly.
 */
export const PREVIEW_FRAME_CSP = [
  "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
  "sandbox allow-scripts allow-forms allow-modals allow-popups",
  "frame-ancestors 'self'",
].join("; ");

/** A nonce for one response: 128 random bits, in base64. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
