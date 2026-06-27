CREATE TYPE "public"."team_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "team_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"default_for_user_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_default_for_user_id_users_id_fk" FOREIGN KEY ("default_for_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_members_user_id_created_at_idx" ON "team_members" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_default_for_user_id_unique" ON "teams" USING btree ("default_for_user_id");--> statement-breakpoint
WITH created_teams AS (
	INSERT INTO "teams" ("name", "default_for_user_id", "created_by_user_id", "created_at", "updated_at")
	SELECT 'Default Team', "users"."id", "users"."id", "users"."created_at", "users"."created_at"
	FROM "users"
	RETURNING "id", "default_for_user_id", "created_at"
)
INSERT INTO "team_members" ("team_id", "user_id", "role", "created_at")
SELECT "id", "default_for_user_id", 'owner'::"team_role", "created_at"
FROM created_teams;
