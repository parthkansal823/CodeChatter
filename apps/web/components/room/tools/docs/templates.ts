import type { JSONContent } from "@tiptap/react";
import { Bug, CalendarRange, FileText, type LucideIcon, NotebookPen, ScrollText, UserRoundSearch } from "lucide-react";

export type TemplateId = "empty" | "meeting" | "rfc" | "bug" | "sprint" | "interview";

export type PageTemplate = {
  id: TemplateId;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** The new page's title; empty leaves it untitled. */
  title: (date: string) => string;
  content: (date: string) => JSONContent | null;
};

// Small builders so the templates read like the pages they make.
const text = (value: string): JSONContent => ({ type: "text", text: value });
const bold = (value: string): JSONContent => ({ type: "text", text: value, marks: [{ type: "bold" }] });
const p = (...parts: Array<string | JSONContent>): JSONContent => {
  const content = parts.filter((part) => part !== "").map((part) => (typeof part === "string" ? text(part) : part));
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
};
const h = (level: 1 | 2 | 3, value: string): JSONContent => ({ type: "heading", attrs: { level }, content: [text(value)] });
const item = (type: "listItem" | "taskItem", value: string): JSONContent => ({
  type,
  ...(type === "taskItem" && { attrs: { checked: false } }),
  content: [p(value)],
});
const bullets = (...items: string[]): JSONContent => ({ type: "bulletList", content: items.map((i) => item("listItem", i)) });
const numbered = (...items: string[]): JSONContent => ({ type: "orderedList", attrs: { start: 1 }, content: items.map((i) => item("listItem", i)) });
const tasks = (...items: string[]): JSONContent => ({ type: "taskList", content: items.map((i) => item("taskItem", i)) });
const callout = (kind: "note" | "warning", ...parts: Array<string | JSONContent>): JSONContent => ({
  type: "callout",
  attrs: { kind },
  content: [p(...parts)],
});
const table = (header: string[], ...rows: string[][]): JSONContent => ({
  type: "table",
  content: [
    { type: "tableRow", content: header.map((cell) => ({ type: "tableHeader", content: [p(cell)] })) },
    ...rows.map((row) => ({ type: "tableRow", content: row.map((cell) => ({ type: "tableCell", content: [p(cell)] })) })),
  ],
});
const code = (language: string, value: string): JSONContent => ({ type: "codeBlock", attrs: { language }, content: [text(value)] });
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });

export const TEMPLATES: PageTemplate[] = [
  {
    id: "empty",
    label: "Empty page",
    hint: "Start from a blank page",
    icon: FileText,
    title: () => "",
    content: () => null,
  },
  {
    id: "meeting",
    label: "Meeting notes",
    hint: "Agenda, notes, decisions, action items",
    icon: NotebookPen,
    title: (date) => `Meeting notes ${date}`,
    content: (date) =>
      doc(
        p(bold("Date: "), date),
        p(bold("Attendees: ")),
        h(2, "Agenda"),
        bullets(""),
        h(2, "Notes"),
        p(),
        h(2, "Decisions"),
        bullets(""),
        h(2, "Action items"),
        tasks(""),
      ),
  },
  {
    id: "rfc",
    label: "Design doc (RFC)",
    hint: "Problem, proposal, alternatives, rollout",
    icon: ScrollText,
    title: () => "Design doc",
    content: (date) =>
      doc(
        table(["Status", "Authors", "Reviewers", "Updated"], ["Draft", "", "", date]),
        h(2, "Summary"),
        p("One paragraph: what changes and why it matters."),
        h(2, "Motivation"),
        p("The problem today, who it affects, and how we know."),
        h(2, "Goals"),
        bullets(""),
        h(2, "Non-goals"),
        bullets(""),
        h(2, "Proposed design"),
        p("How it works. Link the code it touches with [[ and a file name."),
        h(2, "Alternatives considered"),
        bullets(""),
        h(2, "Risks and open questions"),
        callout("warning", "List what could go wrong and what is still undecided."),
        h(2, "Rollout plan"),
        tasks("Behind a flag", "Migrate existing data", "Remove the flag"),
      ),
  },
  {
    id: "bug",
    label: "Bug report",
    hint: "Steps to reproduce, expected and actual",
    icon: Bug,
    title: () => "Bug report",
    content: () =>
      doc(
        table(["Severity", "Area", "Version", "Owner"], ["", "", "", ""]),
        h(2, "Summary"),
        p(),
        h(2, "Steps to reproduce"),
        numbered("", ""),
        h(2, "Expected"),
        p(),
        h(2, "Actual"),
        p(),
        h(2, "Logs"),
        code("text", "Paste the error or stack trace here"),
        h(2, "Environment"),
        bullets("Browser or OS: ", "Commit: "),
        h(2, "Fix"),
        tasks("Write a failing test", "Fix", "Verify in the room"),
      ),
  },
  {
    id: "sprint",
    label: "Sprint plan",
    hint: "Goal, committed work, risks",
    icon: CalendarRange,
    title: (date) => `Sprint starting ${date}`,
    content: (date) =>
      doc(
        p(bold("Dates: "), `${date} to `),
        callout("note", bold("Sprint goal: "), "one sentence the team can say no with."),
        h(2, "Committed"),
        table(["Item", "Owner", "Estimate", "Status"], ["", "", "", "Not started"], ["", "", "", "Not started"]),
        h(2, "Stretch"),
        bullets(""),
        h(2, "Risks and dependencies"),
        bullets(""),
        h(2, "Checklist"),
        tasks("Backlog groomed", "Capacity checked", "Demo planned"),
      ),
  },
  {
    id: "interview",
    label: "Interview kit",
    hint: "Agenda, questions, scorecard",
    icon: UserRoundSearch,
    title: () => "Interview kit",
    content: () =>
      doc(
        p(bold("Role: ")),
        p(bold("Candidate: ")),
        p(bold("Interviewers: ")),
        h(2, "Agenda"),
        table(["Time", "Section"], ["5 min", "Introductions"], ["35 min", "Pair on a problem in this room"], ["10 min", "Design discussion"], ["10 min", "Candidate questions"]),
        h(2, "Questions"),
        h(3, "Problem solving"),
        bullets(""),
        h(3, "Collaboration"),
        bullets(""),
        h(3, "System design"),
        bullets(""),
        h(2, "Scorecard"),
        table(["Signal", "Rating (1 to 4)", "Evidence"], ["Problem solving", "", ""], ["Code quality", "", ""], ["Communication", "", ""], ["Collaboration", "", ""]),
        h(2, "Decision"),
        callout("note", "Hire, no hire, or needs another conversation, with one line on why."),
      ),
  },
];

export const templateById = (id: TemplateId) => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]!;

/**
 * Template content waiting for a new page's document to open. The page is
 * created in the index first; its editor fills the (still empty) document
 * once it has synced, so the content is never written twice.
 */
export const pendingContent = new Map<string, JSONContent>();
