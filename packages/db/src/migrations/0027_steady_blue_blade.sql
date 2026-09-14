ALTER TYPE "public"."git_provider" ADD VALUE 'gitea';--> statement-breakpoint
ALTER TYPE "public"."service_type" ADD VALUE 'gitea-repo' BEFORE 'postgres';--> statement-breakpoint
CREATE TABLE "git_oauth_pending" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"account_login" text NOT NULL,
	"access_token_ciphertext" text NOT NULL,
	"refresh_token_ciphertext" text,
	"token_expires_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "git_app_connections" ALTER COLUMN "private_key_ciphertext" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "git_app_connections" ADD COLUMN "instance_url" text;--> statement-breakpoint
ALTER TABLE "git_installations" ADD COLUMN "access_token_ciphertext" text;--> statement-breakpoint
ALTER TABLE "git_installations" ADD COLUMN "refresh_token_ciphertext" text;--> statement-breakpoint
ALTER TABLE "git_installations" ADD COLUMN "token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "git_oauth_pending" ADD CONSTRAINT "git_oauth_pending_connection_id_git_app_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."git_app_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_oauth_pending" ADD CONSTRAINT "git_oauth_pending_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;