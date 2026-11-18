/** Retain normal messages in the unread index after their author is deleted; system posts remain excluded. */
DROP INDEX "messages_chat_unread_idx";--> statement-breakpoint
CREATE INDEX "messages_chat_unread_idx" ON "messages" USING btree ("room_id","id","user_id") WHERE "messages"."deleted_at" IS NULL AND "messages"."kind" NOT IN ('system', 'github');
