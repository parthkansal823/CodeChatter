import type { AiStreamEvent } from "@codechatter/contracts";

/**
 * Incremental Server-Sent Events parser for a fetch() body (EventSource
 * can't POST). Feed it decoded chunks; it calls back once per complete
 * event and ignores comments (the server's keep-alives).
 */
export function createSseParser(onEvent: (event: AiStreamEvent) => void) {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk.replace(/\r\n/g, "\n");
    for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(line.startsWith("data: ") ? 6 : 5))
        .join("\n");
      if (!data) continue;
      try {
        onEvent(JSON.parse(data) as AiStreamEvent);
      } catch {
        // A malformed event is dropped rather than ending the whole answer.
      }
    }
  };
}
