import { describe, expect, it } from "vitest";

import { ROOM_ACTIONS, ROOM_ROLES, assignableRoles, can } from "./permissions.js";

describe("room permissions", () => {
  it("never lets a viewer change anything", () => {
    const writes = ROOM_ACTIONS.filter((a) => a !== "room.view" && a !== "room.chat");
    for (const action of writes) expect(can("viewer", action)).toBe(false);
  });

  it("keeps the terminal away from anyone who can't edit files", () => {
    // A shell can rewrite files through the sandbox, so terminal ⇒ files.edit.
    for (const role of ROOM_ROLES) {
      if (can(role, "terminal.open")) expect(can(role, "files.edit")).toBe(true);
    }
  });

  it("hides the rubric and hidden tests from candidates", () => {
    expect(can("candidate", "interview.rubric")).toBe(false);
    expect(can("candidate", "interview.hiddenTests")).toBe(false);
    expect(can("interviewer", "interview.hiddenTests")).toBe(true);
  });

  it("only owners delete rooms or open the sandbox network", () => {
    for (const role of ROOM_ROLES) {
      expect(can(role, "room.delete")).toBe(role === "owner");
      expect(can(role, "sandbox.network")).toBe(role === "owner");
    }
  });

  it("denies everything without a role", () => {
    for (const action of ROOM_ACTIONS) expect(can(null, action)).toBe(false);
  });

  it("never hands out owner or more than the inviter holds", () => {
    for (const role of ROOM_ROLES) {
      expect(assignableRoles(role)).not.toContain("owner");
      for (const granted of assignableRoles(role)) {
        for (const action of ROOM_ACTIONS) {
          if (can(granted, action) && granted !== "candidate") expect(can(role, action)).toBe(true);
        }
      }
    }
  });
});
