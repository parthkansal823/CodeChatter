/** Build bounded unread queries and literal LIKE patterns without sharing mutable counters between devices. */
import { sql, type SQL } from "drizzle-orm";

/** PostgreSQL LIKE treats these three characters specially; chat search treats them as text. */
export function escapeChatLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** One statement for every dashboard room, counting at most 100 eligible indexed rows per badge. */
export function chatUnreadQuery(userId: string, roomId?: string): SQL {
  const scope = roomId
    ? sql`(select id as room_id from rooms where id = ${roomId} and archived_at is null)`
    : sql`(select membership.room_id from room_members membership
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
          and message.user_id is not null and message.user_id <> ${userId}
          and message.deleted_at is null and message.kind not in ('system', 'github')
          and message.id > coalesce(reads.last_read_message_id, '00000000-0000-0000-0000-000000000000'::uuid)
        order by message.id asc limit 100
      ) candidate
    ) counted
    order by selected.room_id`;
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
