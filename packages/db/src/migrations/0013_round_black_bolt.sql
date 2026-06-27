CREATE TYPE "public"."ssh_key_scope" AS ENUM('team', 'admin');--> statement-breakpoint
CREATE TYPE "public"."ssh_key_source" AS ENUM('generated', 'uploaded');--> statement-breakpoint
CREATE TYPE "public"."ssh_key_type" AS ENUM('ed25519', 'rsa', 'ecdsa');--> statement-breakpoint
CREATE TABLE "ssh_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "ssh_key_scope" DEFAULT 'team' NOT NULL,
	"team_id" uuid,
	"name" text NOT NULL,
	"key_type" "ssh_key_type" NOT NULL,
	"source" "ssh_key_source" NOT NULL,
	"public_key" text NOT NULL,
	"private_key_ciphertext" text NOT NULL,
	"fingerprint" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ssh_keys_scope_team_id_ck" CHECK (("ssh_keys"."scope" = 'team' AND "ssh_keys"."team_id" IS NOT NULL) OR ("ssh_keys"."scope" = 'admin' AND "ssh_keys"."team_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "ssh_keys" ADD CONSTRAINT "ssh_keys_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_keys" ADD CONSTRAINT "ssh_keys_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ssh_keys_team_id_created_at_idx" ON "ssh_keys" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ssh_keys_team_id_name_unique" ON "ssh_keys" USING btree ("team_id","name");