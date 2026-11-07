CREATE TABLE "ai_traces" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"room_id" text NOT NULL,
	"user_id" text,
	"source" text NOT NULL,
	"mode" text,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	"first_ms" integer,
	"total_ms" integer NOT NULL,
	"input" jsonb NOT NULL,
	"output" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_traces" ADD CONSTRAINT "ai_traces_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_traces" ADD CONSTRAINT "ai_traces_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_traces_room_id_id_index" ON "ai_traces" USING btree ("room_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_traces_created_at_index" ON "ai_traces" USING btree ("created_at");