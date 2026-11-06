import type { RoomActivityItem } from "@codechatter/contracts";
import { schema, type DbHandle } from "@codechatter/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, isNotNull, like, notLike, or, sql } from "drizzle-orm";

import { DB } from "../infra/tokens.js";

const DAYS = 7;
const LIMIT = 100;

/** What a document of the room is, to say what someone edited (its kind: room:ID:<kind>[:id]). */
const PLACE: Record<string, string> = {
  files: "the code",
  pages: "Docs",
  page: "Docs",
  api: "API Studio",
  designs: "Design",
  design: "Design",
  boards: "the whiteboard",
  board: "the whiteboard",
  diagrams: "Diagrams",
  diagram: "Diagrams",
  comments: "code comments",
  notes: "the room's notes",
};

/** What an audited action in a room says, for the feed (others aren't shown). */
const ACTIONS: Record<string, { kind: RoomActivityItem["kind"]; text: (data: Record<string, unknown>) => string }> = {
  "repo.commit": { kind: "commit", text: (d) => `committed and pushed ${d.files ?? "some"} file${d.files === 1 ? "" : "s"} to ${d.branch ?? "GitHub"}` },
  "repo.publish": { kind: "publish", text: (d) => `published the room to GitHub as ${d.repo ?? "a repository"}` },
  "repo.pull-request": { kind: "pull-request", text: (d) => `opened pull request #${d.number ?? "?"}` },
  "sandbox.image": { kind: "settings", text: (d) => `switched the sandbox to the ${d.image ?? "other"} image` },
  "checkpoint.delete": { kind: "checkpoint", text: () => "deleted a checkpoint" },
  "room.member.approve": { kind: "joined", text: (d) => `let ${d.person ?? "someone"} into the room` },
  "room.member.role": { kind: "settings", text: (d) => `made ${d.person ?? "someone"} ${d.role ?? "something else"}` },
  "room.member.remove": { kind: "settings", text: (d) => `removed ${d.person ?? "someone"} from the room` },
  "room.member.leave": { kind: "settings", text: () => "left the room" },
};

/**
 * A room's activity feed: the last week, newest first. Edits come from the documents'
 * update log, by person, place and hour (the log keeps who and when, not what, and never
 * someone's private notes); then commits and settings from the audit log, saved and named
 * checkpoints, who joined, and the repository's activity posted to chat.
 */
@Injectable()
export class ActivityService {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async feed(roomId: string): Promise<RoomActivityItem[]> {
    const since = new Date(Date.now() - DAYS * 24 * 60 * 60_000);
    const { docUpdates, user, auditEvents, checkpoints, roomMembers, messages } = schema;
    const kind = sql<string>`split_part(${docUpdates.docName}, ':', 3)`;
    const hour = sql<Date>`date_trunc('hour', ${docUpdates.ts})`;
    const [edits, audited, saved, joined, github] = await Promise.all([
      this.handle.db
        .select({ who: user.name, kind, edits: sql<number>`count(*)::int`, last: sql<Date>`max(${docUpdates.ts})` })
        .from(docUpdates)
        .innerJoin(user, eq(docUpdates.userId, user.id))
        // Room codes are 6 letters and digits, so they can't carry LIKE wildcards.
        .where(and(like(docUpdates.docName, `room:${roomId}:%`), notLike(docUpdates.docName, `room:${roomId}:mine:%`), gte(docUpdates.ts, since)))
        .groupBy(user.name, kind, hour)
        .orderBy(desc(sql`max(${docUpdates.ts})`))
        .limit(LIMIT),
      this.handle.db
        .select({ action: auditEvents.action, data: auditEvents.data, at: auditEvents.createdAt, who: user.name })
        .from(auditEvents)
        .leftJoin(user, eq(auditEvents.actorId, user.id))
        .where(and(eq(auditEvents.targetId, roomId), gte(auditEvents.createdAt, since)))
        .orderBy(desc(auditEvents.createdAt))
        .limit(LIMIT),
      this.handle.db
        .select({ label: checkpoints.label, kind: checkpoints.kind, at: checkpoints.createdAt, who: user.name })
        .from(checkpoints)
        .leftJoin(user, eq(checkpoints.createdBy, user.id))
        .where(and(eq(checkpoints.roomId, roomId), gte(checkpoints.createdAt, since), or(eq(checkpoints.kind, "manual"), isNotNull(checkpoints.label))))
        .orderBy(desc(checkpoints.createdAt))
        .limit(LIMIT),
      this.handle.db
        .select({ role: roomMembers.role, at: roomMembers.createdAt, who: user.name })
        .from(roomMembers)
        .innerJoin(user, eq(roomMembers.userId, user.id))
        .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.status, "active"), gte(roomMembers.createdAt, since)))
        .limit(LIMIT),
      this.handle.db
        .select({ body: messages.body, at: messages.createdAt })
        .from(messages)
        .where(and(eq(messages.roomId, roomId), eq(messages.kind, "github"), gte(messages.createdAt, since)))
        .orderBy(desc(messages.createdAt))
        .limit(LIMIT),
    ]);

    const items: RoomActivityItem[] = [
      ...edits.map((row) => ({
        at: new Date(row.last).toISOString(),
        kind: "edits" as const,
        who: row.who,
        text: `edited ${PLACE[row.kind] ?? "the room"} (${row.edits === 1 ? "1 change" : `${row.edits} changes`})`,
      })),
      ...audited.flatMap((row) => {
        const shown = ACTIONS[row.action];
        return shown ? [{ at: row.at.toISOString(), kind: shown.kind, who: row.who, text: shown.text(row.data ?? {}) }] : [];
      }),
      ...saved.map((row) => ({
        at: row.at.toISOString(),
        kind: "checkpoint" as const,
        who: row.who,
        text: row.label ? `saved a checkpoint, “${row.label}”` : "saved a checkpoint",
      })),
      ...joined.map((row) => ({ at: row.at.toISOString(), kind: "joined" as const, who: row.who, text: `joined as ${row.role}` })),
      ...github.map((row) => ({ at: row.at.toISOString(), kind: "github" as const, who: null, text: row.body.split("\n")[0]!.slice(0, 200) })),
    ];
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, LIMIT);
  }
}
