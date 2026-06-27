CREATE TYPE "public"."deployment_trigger" AS ENUM('manual', 'auto');--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "trigger" "deployment_trigger" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "auto_deploy_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "last_polled_commit" text;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "last_polled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "next_poll_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "last_poll_error" text;--> statement-breakpoint
CREATE INDEX "services_auto_deploy_next_poll_idx" ON "services" USING btree ("auto_deploy_enabled","next_poll_at");