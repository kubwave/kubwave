CREATE TABLE "build_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"registration_hash" text,
	"registration_expires_at" timestamp with time zone,
	"token_hash" text,
	"paused" boolean DEFAULT false NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"max_concurrent_builds" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp with time zone,
	"protocol_version" integer,
	"version" text,
	"architecture" text,
	"capabilities" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deployment_id" uuid NOT NULL,
	"settings" jsonb NOT NULL,
	"execution" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"agent_id" uuid,
	"attempt" integer DEFAULT 1 NOT NULL,
	"lease_token_hash" text,
	"lease_expires_at" timestamp with time zone,
	"payload_ciphertext" text,
	"image_ref" text,
	"last_error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "build_runs_deployment_id_unique" UNIQUE("deployment_id")
);
--> statement-breakpoint
ALTER TABLE "build_runs" ADD CONSTRAINT "build_runs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_runs" ADD CONSTRAINT "build_runs_agent_id_build_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."build_agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "build_agents_registration_hash_idx" ON "build_agents" USING btree ("registration_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "build_agents_token_hash_idx" ON "build_agents" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "build_runs_status_execution_idx" ON "build_runs" USING btree ("status","execution");--> statement-breakpoint
CREATE INDEX "build_runs_agent_id_idx" ON "build_runs" USING btree ("agent_id");