import { describe, expect, it } from "vitest";

import { mentionedIn, notificationText } from "./notifications.js";

const people = [
  { id: "1", name: "Ana" },
  { id: "2", name: "Anabel" },
  { id: "3", name: "Ben Ruiz" },
];

describe("mentionedIn", () => {
  it("finds people by their shown name, any case, with spaces", () => {
    expect(mentionedIn("@ana can you look?", people).map((p) => p.id)).toEqual(["1"]);
    expect(mentionedIn("ping @ANABEL and @ben ruiz.", people).map((p) => p.id)).toEqual(["2", "3"]);
  });

  it("doesn't take an email address or a longer word for a mention", () => {
    expect(mentionedIn("mail ana@ana.dev", people)).toEqual([]);
    expect(mentionedIn("@anas are here", people)).toEqual([]);
    expect(mentionedIn("no mentions", people)).toEqual([]);
  });
});

describe("notificationText", () => {
  it("says what happened, where", () => {
    const actor = { id: "1", name: "Ana", image: null };
    const room = { id: "TEAM22", name: "Team playground" };
    expect(notificationText({ type: "mention", actor, room, payload: { excerpt: "@Ben look" } })).toBe("Ana mentioned you in Team playground: “@Ben look”");
    expect(notificationText({ type: "comment.reply", actor, room, payload: { path: "app.py", line: 4, excerpt: "done" } })).toBe(
      "Ana replied on app.py:4 in Team playground: “done”",
    );
    expect(notificationText({ type: "room.requested", actor: null, room, payload: {} })).toBe("Someone asked to join Team playground");
  });
});
