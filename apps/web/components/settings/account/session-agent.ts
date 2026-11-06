/** Describe session user agents with a small bounded vocabulary instead of exposing raw device strings or adding a parser package. */
export function describeSessionAgent(value?: string | null): string {
  const agent = value ?? "";
  const browser = /(?:Edg|EdgA|EdgiOS|Edge)\//.test(agent) ? "Edge"
    : /(?:OPR|Opera|OPiOS)\//.test(agent) ? "Opera"
      : /(?:Firefox|FxiOS)\//.test(agent) ? "Firefox"
        : /(?:Chrome|CriOS)\//.test(agent) ? "Chrome"
          : /Safari\//.test(agent) ? "Safari" : "Unknown browser";
  const os = /Windows Phone/.test(agent) ? "Windows Phone"
    : /Windows/.test(agent) ? "Windows"
      : /Android/.test(agent) ? "Android"
        : /iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && /Mobile\//.test(agent)) ? "iOS"
          : /Macintosh|Mac OS X/.test(agent) ? "macOS"
            : /CrOS/.test(agent) ? "ChromeOS"
              : /Linux/.test(agent) ? "Linux" : "unknown OS";
  return agent ? `${browser} on ${os}` : "Unknown device";
}
