export type ChatLine = { createdAt: string; author: string; kind: string; body: string };
export type ActivityRow = { docName: string; who: string | null; edits: number; first: Date; last: Date };

/** "3 min ago": the server doesn't know the reader's time zone, so times are relative. */
export function ago(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} h${rest ? ` ${rest} min` : ""} ago`;
}

const MAX_LINE = 600;

/** Oldest first, newest kept when it doesn't all fit. */
export function formatChat(messages: ChatLine[], now: number, maxChars: number): string {
  const lines = messages.map((m) => {
    const body = m.body.trim();
    const text = body.length > MAX_LINE ? `${body.slice(0, MAX_LINE)}…` : body;
    return `[${ago(now - Date.parse(m.createdAt))}] ${m.kind === "system" ? "(system)" : m.author}: ${text}`;
  });
  const kept: string[] = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (kept.length > 0 && size + lines[i]!.length + 1 > maxChars) break;
    kept.unshift(lines[i]!);
    size += lines[i]!.length + 1;
  }
  const omitted = lines.length - kept.length;
  return omitted > 0 ? [`… ${omitted} earlier ${omitted === 1 ? "message" : "messages"} omitted`, ...kept].join("\n") : kept.join("\n");
}

const WHAT: Record<string, string> = {
  files: "the code files",
  pages: "the docs list",
  page: "a doc page",
  api: "the API studio",
  designs: "the design list",
  design: "a design",
  boards: "the board list",
  board: "a board",
};

/** Who saved edits to what, from the document update log (it records who and when, not which lines). */
export function formatActivity(rows: ActivityRow[], roomId: string, now: number): string {
  const prefix = `room:${roomId}:`;
  const groups = new Map<string, { who: string; what: string; edits: number; first: number; last: number }>();
  for (const row of rows) {
    const kind = row.docName.startsWith(prefix) ? row.docName.slice(prefix.length).split(":")[0]! : row.docName;
    const who = row.who ?? "The sandbox or another system process";
    const what = WHAT[kind] ?? "the room";
    const key = `${who}|${what}`;
    const group = groups.get(key) ?? { who, what, edits: 0, first: Infinity, last: 0 };
    group.edits += row.edits;
    group.first = Math.min(group.first, row.first.getTime());
    group.last = Math.max(group.last, row.last.getTime());
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => b.last - a.last)
    .map((g) => `${g.who} saved ${g.edits} ${g.edits === 1 ? "edit" : "edits"} in ${g.what} (${ago(now - g.first)} to ${ago(now - g.last)})`)
    .join("\n");
}
