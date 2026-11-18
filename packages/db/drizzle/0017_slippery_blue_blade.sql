/** Persist monotonic per-person chat cursors and index only messages that can contribute to unread counts. */
CREATE TABLE "room_chat_reads" (
	"room_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_read_message_id" uuid,
	CONSTRAINT "room_chat_reads_room_id_user_id_pk" PRIMARY KEY("room_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "room_chat_reads" ADD CONSTRAINT "room_chat_reads_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_chat_reads" ADD CONSTRAINT "room_chat_reads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_chat_unread_idx" ON "messages" USING btree ("room_id","id","user_id") WHERE "messages"."user_id" IS NOT NULL AND "messages"."deleted_at" IS NULL AND "messages"."kind" NOT IN ('system', 'github');
