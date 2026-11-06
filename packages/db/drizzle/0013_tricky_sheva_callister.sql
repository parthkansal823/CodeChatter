CREATE TABLE "interview_recordings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"interview_id" uuid NOT NULL,
	"stream" text NOT NULL,
	"key" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interview_batches" ADD COLUMN "record_webcam" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_batches" ADD COLUMN "record_screen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "interviews" ADD COLUMN "record_webcam" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "interviews" ADD COLUMN "record_screen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "interviews" ADD COLUMN "recording_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "interview_recordings" ADD CONSTRAINT "interview_recordings_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interview_recordings_interview_id_stream_started_at_index" ON "interview_recordings" USING btree ("interview_id","stream","started_at");--> statement-breakpoint
CREATE INDEX "interview_recordings_created_at_index" ON "interview_recordings" USING btree ("created_at");