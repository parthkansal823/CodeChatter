import { runnableLanguage, type RunSnapshot } from "@codechatter/contracts";

/** The room's last run, as the server found it (never taken from the browser). */
export type RunContext =
  | { status: "ok"; snapshot: RunSnapshot }
  | { status: "unavailable" };

/** What the room did lately, for summary mode: chat and edit activity come from the server, file changes from the browser. */
export type SummaryContext = { minutes: number; chat: string; activity: string; changes: string };

export type ContextParts = {
  paths?: string[];
  /** Files the person let the agent read. */
  extra?: Array<{ path: string; text: string }>;
  summary?: SummaryContext;
  file?: { path: string; text: string };
  selection?: { path: string; text: string; startLine: number; endLine: number };
  run?: RunContext;
};

/** Terminal output → plain text: no colour codes, and progress bars redrawn with \r keep only their last state. */
export function plainTerminalText(raw: string): string {
  const noAnsi = raw
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC (window titles, links)
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "") // CSI (colours, cursor moves)
    .replace(/\x1b[@-Z\\-_]/g, "");
  return noAnsi
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.slice(line.lastIndexOf("\r") + 1))
    .join("\n");
}

// A final newline ends the last line; it doesn't start another.
const lineCount = (text: string) => (text ? text.replace(/\n$/, "").split("\n").length : 0);

/**
 * Fit text into `max` characters by cutting whole lines out of the middle:
 * the top of a file (imports, types) and its end (usually the entry point)
 * matter most. The marker tells the model exactly which lines are missing.
 */
export function truncateMiddle(text: string, max: number): { text: string; omitted: string | null } {
  if (text.length <= max) return { text, omitted: null };
  const lines = text.split("\n");
  const headBudget = Math.floor(max * 0.6);
  const tailBudget = max - headBudget;
  let head = 0;
  let used = 0;
  while (head < lines.length && used + lines[head]!.length + 1 <= headBudget) used += lines[head++]!.length + 1;
  let tail = lines.length;
  used = 0;
  while (tail > head && used + lines[tail - 1]!.length + 1 <= tailBudget) used += lines[--tail]!.length + 1;
  // One enormous line (minified code): fall back to cutting characters.
  if (head === 0 && tail === lines.length) {
    const omitted = `${text.length - max} characters`;
    return { text: `${text.slice(0, headBudget)}\n… [${omitted} omitted to fit the AI's context] …\n${text.slice(text.length - tailBudget)}`, omitted };
  }
  const omitted = `lines ${head + 1}-${tail}`;
  return { text: [...lines.slice(0, head), `… [${omitted} omitted to fit the AI's context] …`, ...lines.slice(tail)].join("\n"), omitted };
}

/** Keep the end of long output: errors and the final state are at the bottom. */
export function truncateStart(text: string, max: number): { text: string; omitted: boolean } {
  if (text.length <= max) return { text, omitted: false };
  let cut = text.length - max;
  const newline = text.indexOf("\n", cut);
  if (newline !== -1 && newline - cut < 200) cut = newline + 1;
  return { text: `… [earlier output omitted] …\n${text.slice(cut)}`, omitted: true };
}

export function languageLabel(path: string): string | null {
  const known = runnableLanguage(path);
  if (known) return known.label;
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : null;
}

function describeExit(snapshot: RunSnapshot): string {
  const exit = snapshot.exit;
  if (!exit) return "still running";
  switch (exit.reason) {
    case "exit":
      return exit.code === 0 ? "exited with code 0" : `exited with code ${exit.code ?? "unknown"}`;
    case "stopped":
      return "stopped by a person in the room";
    case "timeout":
      return "stopped: hit the time limit";
    case "output-limit":
      return "stopped: printed too much output";
    case "reset":
      return "ended: the sandbox was restarted";
    default:
      return `failed to run${exit.message ? `: ${exit.message}` : ""}`;
  }
}

const attr = (value: string) => value.replace(/"/g, "'");

/**
 * The room context as one block of tagged sections, placed before the
 * person's message. `budget` is the total characters for all of it; the
 * file gets whatever the smaller parts leave.
 */
export function buildContextBlock(parts: ContextParts, budget: number): string {
  const sections: string[] = [];
  let used = 0;

  if (parts.paths?.length) {
    const max = Math.floor(budget * 0.1);
    const shown: string[] = [];
    let size = 0;
    for (const path of parts.paths) {
      if (size + path.length + 1 > max) break;
      shown.push(path);
      size += path.length + 1;
    }
    const more = parts.paths.length - shown.length;
    const body = shown.join("\n") + (more > 0 ? `\n… and ${more} more` : "");
    sections.push(`<room_files count="${parts.paths.length}">\n${body}\n</room_files>`);
    used += body.length;
  }

  if (parts.summary) {
    const { minutes, chat, activity, changes } = parts.summary;
    sections.push(
      `<recent_chat minutes="${minutes}">
${chat || "(no messages in this window)"}
</recent_chat>`,
      `<edit_activity minutes="${minutes}">
${activity || "(nobody saved edits in this window)"}
</edit_activity>`,
      `<file_changes>
${changes || "(this browser tab saw no file changes)"}
</file_changes>`,
    );
    used += chat.length + activity.length + changes.length;
  }

  if (parts.extra?.length) {
    const share = Math.max(1000, Math.floor((budget * 0.35) / parts.extra.length));
    for (const file of parts.extra) {
      const cut = truncateMiddle(file.text, share);
      sections.push(
        `<file path="${attr(file.path)}" lines="${lineCount(file.text)}"${cut.omitted ? ` truncated="${cut.omitted}"` : ""}>
${cut.text}
</file>`,
      );
      used += cut.text.length;
    }
  }

  if (parts.selection) {
    const { path, startLine, endLine } = parts.selection;
    const cut = truncateMiddle(parts.selection.text, Math.floor(budget * 0.25));
    sections.push(
      `<selection path="${attr(path)}" lines="${startLine}-${endLine}"${cut.omitted ? ` truncated="${cut.omitted}"` : ""}>\n${cut.text}\n</selection>`,
    );
    used += cut.text.length;
  }

  if (parts.run) {
    if (parts.run.status === "unavailable") {
      sections.push(`<run_output status="unavailable">The runner couldn't be reached, so the last run's output isn't available.</run_output>`);
    } else if (!parts.run.snapshot.run) {
      sections.push(`<run_output status="none">Nobody has run code in this room yet.</run_output>`);
    } else {
      const { run } = parts.run.snapshot;
      const cut = truncateStart(plainTerminalText(parts.run.snapshot.output), Math.floor(budget * 0.2));
      const body = cut.text.trim() ? cut.text : "(no output)";
      sections.push(
        `<run_output command="${attr(run.command)}" file="${attr(run.path)}" result="${attr(describeExit(parts.run.snapshot))}">\n${body}\n</run_output>`,
      );
      used += body.length;
    }
  }

  if (parts.file) {
    const { path } = parts.file;
    const cut = truncateMiddle(parts.file.text, Math.max(2000, budget - used));
    const language = languageLabel(path);
    sections.push(
      `<active_file path="${attr(path)}"${language ? ` language="${attr(language)}"` : ""} lines="${lineCount(parts.file.text)}"${cut.omitted ? ` truncated="${cut.omitted}"` : ""}>\n${cut.text}\n</active_file>`,
    );
  }

  return sections.join("\n\n");
}
