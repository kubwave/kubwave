CREATE TYPE "public"."deployment_log_kind" AS ENUM('event', 'build-output');--> statement-breakpoint
CREATE TABLE "deployment_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deployment_id" uuid NOT NULL,
	"kind" "deployment_log_kind" NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"step" text NOT NULL,
	"message" text NOT NULL,
	"container_name" text,
	"source_ts" timestamp with time zone,
	"line_hash" text
);
--> statement-breakpoint
ALTER TABLE "deployment_logs" ADD CONSTRAINT "deployment_logs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deployment_logs_deployment_id_ts_idx" ON "deployment_logs" USING btree ("deployment_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "deployment_logs_build_line_unique" ON "deployment_logs" USING btree ("deployment_id","container_name","source_ts","line_hash");--> statement-breakpoint
INSERT INTO "deployment_logs" ("deployment_id", "kind", "ts", "level", "step", "message")
SELECT
	"d"."id",
	'event'::"deployment_log_kind",
	COALESCE(NULLIF("entry"->>'ts', '')::timestamp with time zone, "d"."created_at"),
	COALESCE(NULLIF("entry"->>'level', ''), 'info'),
	COALESCE(NULLIF("entry"->>'step', ''), 'log'),
	COALESCE("entry"->>'message', '')
FROM "deployments" "d"
CROSS JOIN LATERAL jsonb_array_elements("d"."logs") AS "entry";--> statement-breakpoint
ALTER TABLE "deployments" DROP COLUMN "logs";
