ALTER TABLE "interview_batches" ADD COLUMN "ai_review_recording" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "interviews" ADD COLUMN "ai_review_recording" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "interviews" ADD COLUMN "ai_review" jsonb;