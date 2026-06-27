CREATE TABLE "platform_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"current_version" text DEFAULT '' NOT NULL,
	"latest_version" text,
	"available_versions" jsonb DEFAULT '[]'::jsonb,
	"last_checked_at" timestamp with time zone,
	"last_etag" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "update_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_version" text NOT NULL,
	"to_version" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"phase" text,
	"last_error" text,
	"job_name" text,
	"old_image_tags" jsonb,
	"triggered_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "update_runs" ADD CONSTRAINT "update_runs_triggered_by_user_id_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;