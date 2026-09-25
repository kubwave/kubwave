CREATE TABLE "mcp_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_credentials" (
	"hash" text PRIMARY KEY NOT NULL,
	"grant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"redirect_uri" text,
	"code_challenge" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mcp_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"client_id" text,
	"resource" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"team_id" uuid,
	"project_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_requests" (
	"grant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_requests_grant_id_request_id_pk" PRIMARY KEY("grant_id","request_id")
);
--> statement-breakpoint
ALTER TABLE "mcp_credentials" ADD CONSTRAINT "mcp_credentials_grant_id_mcp_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_grants" ADD CONSTRAINT "mcp_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_grants" ADD CONSTRAINT "mcp_grants_client_id_mcp_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."mcp_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_grants" ADD CONSTRAINT "mcp_grants_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_requests" ADD CONSTRAINT "mcp_requests_grant_id_mcp_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_grants"("id") ON DELETE cascade ON UPDATE no action;