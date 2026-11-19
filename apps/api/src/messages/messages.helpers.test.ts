/** Check bounded badges, literal highlighting/search escaping and the SQL invariants behind per-device read positions. */
import {
  capChatUnreadCount,
  chatSearchTerms,
  chatUnreadLabel,
  highlightChatSearch,
  isCountedChatMessage,
} from "@codechatter/contracts";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { chatUnreadQuery, escapeChatLike, markChatReadQuery, registerChatReaderQuery } from "./messages.helpers.js";

const dialect = new PgDialect({ casing: "snake_case" });

describe("chat display and literal search helpers", () => {
  it("counts retained normal messages after author removal, while excluding own and integration posts", () => {
    const other = { id: "other", name: "Other", image: null };
    const me = { id: "reader", name: "Reader", image: null };
    for (const kind of ["text", "code", "file"] as const) {
      expect(isCountedChatMessage({ kind, author: null }, "reader")).toBe(true);
      expect(isCountedChatMessage({ kind, author: other }, "reader")).toBe(true);
      expect(isCountedChatMessage({ kind, author: me }, "reader")).toBe(false);
    }
    for (const kind of ["system", "github", "automation"] as const) {
      expect(isCountedChatMessage({ kind, author: null }, "reader")).toBe(false);
      expect(isCountedChatMessage({ kind, author: other }, "reader")).toBe(false);
    }
  });
  it("caps the count at 99+ without negative or invalid badge values", () => {
    expect([0, 1, 99, 100, 10_000].map(chatUnreadLabel)).toEqual(["0", "1", "99", "99+", "99+"]);
    expect([-1, NaN, -Infinity, 1.9, Infinity].map(capChatUnreadCount)).toEqual([0, 0, 0, 1, 100]);
  });

  it("splits literal AND terms without dropping symbol-only queries", () => {
    expect(chatSearchTerms("  HELLO\nworld hello % _  ")).toEqual(["hello", "world", "%", "_"]);
    expect(chatSearchTerms("   ")).toEqual([]);
    expect(escapeChatLike("100% path_name c:\\code")).toBe("100\\% path\\_name c:\\\\code");
  });

  it("marks literal words case-insensitively and merges overlapping matches", () => {
    expect(highlightChatSearch("Banana 100% path_name [x]", "ANA % _ [x]")).toEqual([
      { text: "B", match: false },
      { text: "anana", match: true },
      { text: " 100", match: false },
      { text: "%", match: true },
      { text: " path", match: false },
      { text: "_", match: true },
      { text: "name ", match: false },
      { text: "[x]", match: true },
    ]);
    expect(highlightChatSearch("<script> plain text", "<script>")).toEqual([
      { text: "<script>", match: true },
      { text: " plain text", match: false },
    ]);
    expect(highlightChatSearch("unchanged", " ")).toEqual([{ text: "unchanged", match: false }]);
  });
});

describe("unread SQL invariants", () => {
  it("counts all active dashboard memberships in one bounded indexed statement", () => {
    const query = dialect.sqlToQuery(chatUnreadQuery("reader"));
    expect(query.sql).toContain("membership.status = 'active'");
    expect(query.sql).toContain("room.archived_at is null");
    expect(query.sql).toContain("message.room_id = selected.room_id");
    expect(query.sql).toContain("message.user_id is distinct from");
    expect(query.sql).toContain("message.deleted_at is null");
    expect(query.sql).toContain("message.kind not in ('system', 'github', 'automation')");
    expect(query.sql).toContain(
      "message.id > coalesce(reads.last_read_message_id, '00000000-0000-0000-0000-000000000000'::uuid)",
    );
    expect(query.sql).toContain("order by message.id asc limit 100");
    expect(query.sql).toContain("cross join lateral");
    expect(query.params).toEqual(["reader", "reader", "reader"]);
  });

  it("counts from when someone joined until they've read something, never the whole history", () => {
    const query = dialect.sqlToQuery(chatUnreadQuery("reader"));
    expect(query.sql).toContain("membership.created_at as since");
    expect(query.sql).toContain("reads.last_read_message_id is not null or message.created_at >= coalesce(selected.since, 'infinity'::timestamptz)");
  });

  it("starts a visitor at the room's latest message, and leaves a member to count from joining", () => {
    const query = dialect.sqlToQuery(registerChatReaderQuery("E2ETST", "visitor"));
    expect(query.sql).toContain("when exists (select 1 from room_members membership");
    expect(query.sql).toContain("order by message.id desc limit 1");
    expect(query.sql).toContain("on conflict (room_id, user_id) do nothing");
    expect(query.params).toEqual(["E2ETST", "visitor", "E2ETST", "visitor", "E2ETST"]);
  });

  it("keeps a public visitor's single-room count scoped to that room and that reader", () => {
    const query = dialect.sqlToQuery(chatUnreadQuery("visitor", "E2ETST"));
    expect(query.sql).not.toContain("membership.status");
    expect(query.params).toEqual(["visitor", "E2ETST", "visitor", "visitor"]);
    expect(query.sql).toContain("reads.user_id =");
  });

  it("validates the message's room in the same atomic statement that keeps the greatest cursor", () => {
    const query = dialect.sqlToQuery(
      markChatReadQuery("E2ETST", "reader", "019baabc-0000-7000-8000-000000000001"),
    );
    expect(query.sql).toContain("select");
    expect(query.sql).toContain("where message.room_id =");
    expect(query.sql).toContain("message.id =");
    expect(query.sql).toContain("on conflict (room_id, user_id) do update");
    expect(query.sql).toContain(
      "greatest(room_chat_reads.last_read_message_id, excluded.last_read_message_id)",
    );
    expect(query.params).toEqual(["E2ETST", "reader", "E2ETST", "019baabc-0000-7000-8000-000000000001"]);
  });
});
