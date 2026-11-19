/** Build bounded unread queries and literal LIKE patterns without sharing mutable counters between devices. */
import { sql, type SQL } from "drizzle-orm";

/** PostgreSQL LIKE treats these three characters specially; chat search treats them as text. */
export function escapeChatLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * One statement for every dashboard room, counting at most 100 eligible indexed rows per badge. Someone who hasn't read anything in a room yet counts from
 * when they joined it (`since`), not its whole history: a new member doesn't open to 99+. A visitor's first look sets where they've read to
 * (registerChatReaderQuery); with neither, nothing counts.
 */
export function chatUnreadQuery(userId: string, roomId?: string): SQL {
  const scope = roomId
    ? sql`(select room.id as room_id, membership.created_at as since from rooms room
        left join room_members membership on membership.room_id = room.id and membership.user_id = ${userId}
        where room.id = ${roomId} and room.archived_at is null)`
    : sql`(select membership.room_id, membership.created_at as since from room_members membership
        inner join rooms room on room.id = membership.room_id
        where membership.user_id = ${userId} and membership.status = 'active' and room.archived_at is null)`;
  return sql`
    select selected.room_id as "roomId", reads.last_read_message_id::text as "readThroughId",
      counted.count, counted."firstUnreadId"
    from ${scope} selected
    left join room_chat_reads reads on reads.room_id = selected.room_id and reads.user_id = ${userId}
    cross join lateral (
      select count(*)::integer as count, min(candidate.id::text) as "firstUnreadId"
      from (
        select message.id from messages message
        where message.room_id = selected.room_id
          and message.user_id is distinct from ${userId}
          and message.deleted_at is null and message.kind not in ('system', 'github', 'automation')
          and message.id > coalesce(reads.last_read_message_id, '00000000-0000-0000-0000-000000000000'::uuid)
          and (reads.last_read_message_id is not null or message.created_at >= coalesce(selected.since, 'infinity'::timestamptz))
        order by message.id asc limit 100
      ) candidate
    ) counted
    order by selected.room_id`;
}

/**
 * Someone reading a room's chat for the first time: a member counts from when they joined, so is left as they are; a visitor counts from now, so their
 * read position starts at the room's latest message (or before any, in a room with none yet). Never moves one that's there.
 */
export function registerChatReaderQuery(roomId: string, userId: string): SQL {
  return sql`
    insert into room_chat_reads (room_id, user_id, last_read_message_id)
    select ${roomId}, ${userId}, case
      when exists (select 1 from room_members membership where membership.room_id = ${roomId} and membership.user_id = ${userId}) then null
      else coalesce(
        (select message.id from messages message where message.room_id = ${roomId} order by message.id desc limit 1),
        '00000000-0000-0000-0000-000000000000'::uuid)
    end
    on conflict (room_id, user_id) do nothing`;
}

/** Validate the cursor's room and advance atomically: a stale second device cannot overwrite a later read. */
export function markChatReadQuery(roomId: string, userId: string, messageId: string): SQL {
  return sql`
    insert into room_chat_reads (room_id, user_id, last_read_message_id)
    select ${roomId}, ${userId}, message.id from messages message
    where message.room_id = ${roomId} and message.id = ${messageId}::uuid
    on conflict (room_id, user_id) do update
      set last_read_message_id = greatest(room_chat_reads.last_read_message_id, excluded.last_read_message_id)
    returning last_read_message_id::text as "readThroughId"`;
}
