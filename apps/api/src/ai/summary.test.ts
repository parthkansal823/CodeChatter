import { describe, expect, it } from "vitest";

import { ago, formatActivity, formatChat } from "./summary.js";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

describe("ago", () => {
  it("is relative and short", () => {
    expect(ago(20_000)).toBe("just now");
    expect(ago(5 * 60_000)).toBe("5 min ago");
    expect(ago(60 * 60_000)).toBe("1 h ago");
    expect(ago(135 * 60_000)).toBe("2 h 15 min ago");
  });
});

describe("formatChat", () => {
  const messages = [
    { createdAt: at(50), author: "Priya", kind: "text", body: "Should we use a heap?" },
    { createdAt: at(40), author: "Sam", kind: "text", body: "Yes. I'll write it." },
    { createdAt: at(30), author: "", kind: "system", body: "Sam ran main.py" },
  ];

  it("lists messages oldest first with relative times", () => {
    expect(formatChat(messages, NOW, 10_000)).toBe(
      ["[50 min ago] Priya: Should we use a heap?", "[40 min ago] Sam: Yes. I'll write it.", "[30 min ago] (system): Sam ran main.py"].join("\n"),
    );
  });

  it("keeps the newest messages when they don't all fit, and says so", () => {
    const text = formatChat(messages, NOW, 50);
    expect(text.startsWith("… 2 earlier messages omitted")).toBe(true);
    expect(text).toContain("Sam ran main.py");
    expect(text).not.toContain("heap");
  });

  it("shortens one very long message", () => {
    const text = formatChat([{ createdAt: at(1), author: "A", kind: "text", body: "x".repeat(5000) }], NOW, 10_000);
    expect(text.length).toBeLessThan(700);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("formatActivity", () => {
  it("groups edits by person and kind of document", () => {
    const text = formatActivity(
      [
        { docName: "room:TEAM22:files", who: "Priya", edits: 10, first: new Date(NOW - 50 * 60_000), last: new Date(NOW - 20 * 60_000) },
        { docName: "room:TEAM22:files", who: "Priya", edits: 4, first: new Date(NOW - 15 * 60_000), last: new Date(NOW - 5 * 60_000) },
        { docName: "room:TEAM22:page:0190-abc", who: "Sam", edits: 1, first: new Date(NOW - 30 * 60_000), last: new Date(NOW - 30 * 60_000) },
        { docName: "room:TEAM22:files", who: null, edits: 2, first: new Date(NOW - 45 * 60_000), last: new Date(NOW - 44 * 60_000) },
      ],
      "TEAM22",
      NOW,
    );
    expect(text.split("\n")).toEqual([
      "Priya saved 14 edits in the code files (50 min ago to 5 min ago)",
      "Sam saved 1 edit in a doc page (30 min ago to 30 min ago)",
      "The sandbox or another system process saved 2 edits in the code files (45 min ago to 44 min ago)",
    ]);
  });

  it("is empty when nobody edited", () => {
    expect(formatActivity([], "TEAM22", NOW)).toBe("");
  });
});
