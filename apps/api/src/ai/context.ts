import { redactSecrets, runnableLanguage, type ProjectDigest, type RunSnapshot } from "@codechatter/contracts";

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
  project?: ProjectDigest;
  retrieved?: Array<{ path: string; start: number; end: number; name: string; text: string; found: string }>;
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

/** A project's contents can't close the sections around them, and whatever the browser let through, no secret goes on from here. */
const projectText = (text: string) => redactSecrets(text).replace(/<(\/?)\s*project_/gi, "<$1_project_");

/** What a search found: most of the model's room, best first. A passage can't close its section, and no secret goes on from here. */
function passageSections(passages: NonNullable<ContextParts["retrieved"]>, budget: number): string[] {
  const sections: string[] = [];
  let left = Math.floor(budget * 0.8);
  for (const passage of passages) {
    const room = Math.min(left, Math.max(800, Math.floor((budget * 0.8) / passages.length) * 2));
    if (room < 200) break;
    const cut = truncateMiddle(redactSecrets(passage.text).replace(/<(\/?)\s*passage/gi, "<$1_passage"), room);
    sections.push(`<passage path="${attr(passage.path)}" lines="${passage.start}-${passage.end}"${passage.name ? ` name="${attr(passage.name)}"` : ""}>\n${cut.text}\n</passage>`);
    left -= cut.text.length;
  }
  return sections;
}

/** Most of the room goes on what was read in full; what's left, on outlines of the rest. */
function projectSections(project: ProjectDigest, budget: number): string[] {
  const sections: string[] = [];
  let left = budget;
  const fit = (text: string, share: number) => {
    const cut = truncateMiddle(text, Math.max(0, Math.min(left, Math.floor(budget * share))));
    left -= cut.text.length;
    return cut;
  };
  const facts = fit(project.facts.map((fact) => `- ${projectText(fact)}`).join("\n"), 0.3);
  sections.push(`<project_facts files="${project.counts.files}" lines="${project.counts.lines}">\n${facts.text || "(none)"}\n</project_facts>`);
  const tree = fit(project.tree.map(projectText).join("\n"), 0.15);
  sections.push(`<project_tree shown="${tree.omitted ? "some" : "all"}">\n${tree.text}\n</project_tree>`);
  const reading = Math.floor(budget * 0.4);
  let read = 0;
  for (const file of project.files) {
    const room = Math.min(reading - read, left);
    if (room < 200) break;
    const cut = truncateMiddle(projectText(file.text), Math.min(room, Math.max(1500, Math.floor(reading / Math.max(1, project.files.length)) * 2)));
    sections.push(`<project_file path="${attr(projectText(file.path))}"${cut.omitted ? ` truncated="${cut.omitted}"` : ""}>\n${cut.text}\n</project_file>`);
    read += cut.text.length;
    left -= cut.text.length;
  }
  const outlines: string[] = [];
  for (const outline of project.outlines) {
    const text = `${projectText(outline.path)}\n${outline.lines.map((line) => `  ${projectText(line)}`).join("\n")}`;
    if (text.length + 1 > left) break;
    outlines.push(text);
    left -= text.length + 1;
  }
  const more = project.outlines.length - outlines.length;
  if (outlines.length) sections.push(`<project_outline files="${outlines.length}"${more ? ` not_shown="${more}"` : ""}>\n${outlines.join("\n")}\n</project_outline>`);
  return sections;
}

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

  if (parts.project) sections.push(...projectSections(parts.project, budget));
  if (parts.retrieved) sections.push(parts.retrieved.length ? passageSections(parts.retrieved, budget).join("\n") : "<passages>The search found nothing.</passages>");

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
