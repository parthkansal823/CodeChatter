CREATE TABLE "interview_questions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" text NOT NULL,
	"title" text NOT NULL,
	"prompt" text DEFAULT '' NOT NULL,
	"file" text NOT NULL,
	"starter_files" jsonb NOT NULL,
	"tests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rubric" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"time_limit_ms" integer DEFAULT 2000 NOT NULL,
	"created_by" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"interview_id" uuid NOT NULL,
	"user_id" text,
	"path" text NOT NULL,
	"compile_error" text,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"passed" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interviews" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" text NOT NULL,
	"room_id" text NOT NULL,
	"question_id" uuid,
	"question" jsonb NOT NULL,
	"candidate_name" text NOT NULL,
	"candidate_email" text,
	"interviewer_id" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"duration_minutes" integer NOT NULL,
	"started_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"candidate_token_hash" text NOT NULL,
	"candidate_user_id" text,
	"candidate_joined_at" timestamp with time zone,
	"scorecard" jsonb DEFAULT '{"scores":[],"overall":null,"recommendation":null,"notes":""}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interview_questions" ADD CONSTRAINT "interview_questions_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_questions" ADD CONSTRAINT "interview_questions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_runs" ADD CONSTRAINT "interview_runs_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_runs" ADD CONSTRAINT "interview_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_question_id_interview_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."interview_questions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_interviewer_id_user_id_fk" FOREIGN KEY ("interviewer_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_candidate_user_id_user_id_fk" FOREIGN KEY ("candidate_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interview_questions_org_id_updated_at_index" ON "interview_questions" USING btree ("org_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "interview_runs_interview_id_created_at_index" ON "interview_runs" USING btree ("interview_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "interviews_org_id_created_at_index" ON "interviews" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "interviews_room_id_index" ON "interviews" USING btree ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "interviews_candidate_token_hash_index" ON "interviews" USING btree ("candidate_token_hash");--> statement-breakpoint
CREATE INDEX "interviews_due_idx" ON "interviews" USING btree ("ends_at") WHERE "interviews"."status" = 'live';