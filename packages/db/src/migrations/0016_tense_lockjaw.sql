CREATE TYPE "public"."environment_kind" AS ENUM('persistent', 'preview');--> statement-breakpoint
ALTER TYPE "public"."deployment_trigger" ADD VALUE 'preview';--> statement-breakpoint
ALTER TABLE "environments" ADD COLUMN "kind" "environment_kind" DEFAULT 'persistent' NOT NULL;--> statement-breakpoint
ALTER TABLE "environments" ADD COLUMN "pr_previews_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "environments" ADD COLUMN "base_environment_id" uuid;--> statement-breakpoint
ALTER TABLE "environments" ADD COLUMN "pr_number" integer;--> statement-breakpoint
ALTER TABLE "environments" ADD COLUMN "pr_repo_url" text;--> statement-breakpoint
ALTER TABLE "environments" ADD COLUMN "pr_ref" text;--> statement-breakpoint
ALTER TABLE "environments" ADD COLUMN "pr_next_poll_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "environments" ADD COLUMN "pr_last_polled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "environments" ADD COLUMN "pr_last_poll_error" text;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_base_environment_id_environments_id_fk" FOREIGN KEY ("base_environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "environments_base_repo_pr_unique" ON "environments" USING btree ("base_environment_id","pr_repo_url","pr_number");--> statement-breakpoint
CREATE INDEX "environments_pr_previews_next_poll_idx" ON "environments" USING btree ("pr_previews_enabled","pr_next_poll_at");