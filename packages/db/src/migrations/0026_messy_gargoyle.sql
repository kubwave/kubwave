ALTER TABLE "services" ADD COLUMN "image_watch_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "last_watched_digest" text;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "last_watched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "next_watch_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "last_watch_error" text;--> statement-breakpoint
CREATE INDEX "services_image_watch_next_watch_idx" ON "services" USING btree ("image_watch_enabled","next_watch_at");