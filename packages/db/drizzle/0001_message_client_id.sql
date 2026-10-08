ALTER TABLE "messages" ADD COLUMN "client_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_room_id_client_id_index" ON "messages" USING btree ("room_id","client_id");