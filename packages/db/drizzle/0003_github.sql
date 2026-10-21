CREATE TABLE "github_tokens" (
	"user_id" text PRIMARY KEY NOT NULL,
	"login" text NOT NULL,
	"sealed" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_repos" (
	"room_id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"branch" text NOT NULL,
	"commit_sha" text NOT NULL,
	"files" "bytea" NOT NULL,
	"imported_by" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "github_tokens" ADD CONSTRAINT "github_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_repos" ADD CONSTRAINT "room_repos_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_repos" ADD CONSTRAINT "room_repos_imported_by_user_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;