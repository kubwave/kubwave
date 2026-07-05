CREATE TYPE "public"."git_provider" AS ENUM('github');--> statement-breakpoint
CREATE TABLE "git_app_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "git_provider" DEFAULT 'github' NOT NULL,
	"app_id" text NOT NULL,
	"app_slug" text NOT NULL,
	"client_id" text,
	"client_secret_ciphertext" text,
	"private_key_ciphertext" text NOT NULL,
	"webhook_secret_ciphertext" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "git_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"github_installation_id" text NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"team_id" uuid NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "git_repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" uuid NOT NULL,
	"repo_full_name" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"is_private" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "git_app_connections" ADD CONSTRAINT "git_app_connections_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_installations" ADD CONSTRAINT "git_installations_connection_id_git_app_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."git_app_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_installations" ADD CONSTRAINT "git_installations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_repositories" ADD CONSTRAINT "git_repositories_installation_id_git_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."git_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "git_app_connections_provider_app_id_unique" ON "git_app_connections" USING btree ("provider","app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "git_installations_connection_github_id_unique" ON "git_installations" USING btree ("connection_id","github_installation_id");--> statement-breakpoint
CREATE INDEX "git_installations_team_id_idx" ON "git_installations" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "git_repositories_installation_full_name_unique" ON "git_repositories" USING btree ("installation_id","repo_full_name");