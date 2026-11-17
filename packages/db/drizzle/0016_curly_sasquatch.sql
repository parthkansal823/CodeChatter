/** Replace the shared scorecard with attributed private drafts and submitted reviews, preserving legacy judgements before dropping the old column. */
CREATE TABLE "interview_scorecards" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"interview_id" uuid NOT NULL,
	"interviewer_id" text,
	"scores" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"overall" integer,
	"recommendation" text,
	"notes" text DEFAULT '' NOT NULL,
	"submitted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interview_scorecards" ADD CONSTRAINT "interview_scorecards_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_scorecards" ADD CONSTRAINT "interview_scorecards_interviewer_id_user_id_fk" FOREIGN KEY ("interviewer_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "interview_scorecards_interview_interviewer_idx" ON "interview_scorecards" USING btree ("interview_id","interviewer_id");--> statement-breakpoint
-- The creator lives on the room, not the interview. Fall back to the assigned
-- interviewer; if both were deleted, retain an unattributed historical review.
-- Drizzle's migrator runs this entire migration transactionally, including DROP.
INSERT INTO "interview_scorecards" (
  "interview_id", "interviewer_id", "scores", "overall", "recommendation", "notes", "submitted_at", "updated_at"
)
SELECT i."id", coalesce(r."created_by", i."interviewer_id"),
  coalesce(i."scorecard"->'scores', '[]'::jsonb),
  (i."scorecard"->>'overall')::integer,
  i."scorecard"->>'recommendation',
  coalesce(i."scorecard"->>'notes', ''), i."updated_at", i."updated_at"
FROM "interviews" i
JOIN "rooms" r ON r."id" = i."room_id"
WHERE nullif(btrim(i."scorecard"->>'notes'), '') IS NOT NULL
   OR i."scorecard"->>'overall' IS NOT NULL
   OR nullif(i."scorecard"->>'recommendation', '') IS NOT NULL
   OR EXISTS (
     SELECT 1 FROM jsonb_array_elements(coalesce(i."scorecard"->'scores', '[]'::jsonb)) s
     WHERE s->>'score' IS NOT NULL OR nullif(btrim(s->>'note'), '') IS NOT NULL
   );
--> statement-breakpoint
ALTER TABLE "interviews" DROP COLUMN "scorecard";
