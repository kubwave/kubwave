CREATE TABLE "service_flow_nodes" (
	"environment_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_flow_nodes_environment_id_service_id_pk" PRIMARY KEY("environment_id","service_id"),
	CONSTRAINT "service_flow_nodes_revision_positive_ck" CHECK ("service_flow_nodes"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "service_flow_nodes" ADD CONSTRAINT "service_flow_nodes_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_flow_nodes" ADD CONSTRAINT "service_flow_nodes_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_flow_nodes" ADD CONSTRAINT "service_flow_nodes_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_flow_nodes_service_id_idx" ON "service_flow_nodes" USING btree ("service_id");