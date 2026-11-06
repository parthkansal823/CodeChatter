CREATE TABLE "interview_answers" (
	"interview_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"choice_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"awarded" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interview_answers_interview_id_question_id_pk" PRIMARY KEY("interview_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "interview_batches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" text NOT NULL,
	"mode" text NOT NULL,
	"title" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"paper" jsonb NOT NULL,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"fullscreen" boolean DEFAULT false NOT NULL,
	"lock_clipboard" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"interview_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interview_questions" ADD COLUMN "kind" text DEFAULT 'coding' NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_questions" ADD COLUMN "difficulty" text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_questions" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_questions" ADD COLUMN "marks" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_questions" ADD COLUMN "choices" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_questions" ADD COLUMN "model_answer" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_runs" ADD COLUMN "question_id" text;--> statement-breakpoint
ALTER TABLE "interviews" ADD COLUMN "mode" text DEFAULT 'interview' NOT NULL;--> statement-breakpoint
ALTER TABLE "interviews" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "interviews" ADD COLUMN "paper" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "interviews" ADD COLUMN "opens_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "interviews" ADD COLUMN "closes_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "interviews" ADD COLUMN "fullscreen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "interviews" ADD COLUMN "lock_clipboard" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "interviews" ADD COLUMN "beat_session" text;--> statement-breakpoint
ALTER TABLE "interviews" ADD COLUMN "beat_network" text;--> statement-breakpoint
ALTER TABLE "interviews" ADD COLUMN "beat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "interview_answers" ADD CONSTRAINT "interview_answers_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_batches" ADD CONSTRAINT "interview_batches_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_batches" ADD CONSTRAINT "interview_batches_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_events" ADD CONSTRAINT "interview_events_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interview_batches_org_id_created_at_index" ON "interview_batches" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "interview_events_interview_id_at_index" ON "interview_events" USING btree ("interview_id","at");--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_batch_id_interview_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."interview_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interviews_closing_idx" ON "interviews" USING btree ("closes_at") WHERE "interviews"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX "interviews_batch_id_index" ON "interviews" USING btree ("batch_id");