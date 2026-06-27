CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"type" "service_type" NOT NULL,
	"config" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"phase" text,
	"last_error" text,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"triggered_by_user_id" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_triggered_by_user_id_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deployments_service_id_created_at_idx" ON "deployments" USING btree ("service_id","created_at");--> statement-breakpoint
CREATE INDEX "deployments_status_idx" ON "deployments" USING btree ("status");--> statement-breakpoint
-- Hand-written tail (drizzle can't express a partial index): enforce at most one
-- QUEUED ('pending') deployment per service at the DB level, so the "latest wins"
-- supersede logic in the API is race-proof. 'deploying' rows are intentionally not
-- constrained, so one in-flight + one queued deployment per service may coexist.
CREATE UNIQUE INDEX "deployments_single_pending_per_service" ON "deployments" ("service_id") WHERE status = 'pending';