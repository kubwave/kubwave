ALTER TABLE "deployments" ADD COLUMN "image_ref" text;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "rollback_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH "build_registry" AS (
	SELECT trim(trailing '/' from "settings"."value"->>'endpoint') AS "endpoint"
	FROM "settings"
	WHERE "settings"."key" = 'build-registry'
		AND "settings"."value"->>'mode' = 'external'
		AND coalesce("settings"."value"->>'endpoint', '') <> ''
	LIMIT 1
)
UPDATE "deployments"
SET "image_ref" = "build_registry"."endpoint" || '/env-' || "services"."environment_id" || '/svc-' || "deployments"."service_id" || ':' || "deployments"."id"
FROM "services", "build_registry"
WHERE "deployments"."service_id" = "services"."id"
	AND "deployments"."type"::text IN ('dockerfile', 'public-repo', 'private-repo')
	AND "deployments"."image_ref" IS NULL
	AND "build_registry"."endpoint" IS NOT NULL;
