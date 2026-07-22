CREATE TABLE "service_port_exposures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"container_port" integer NOT NULL,
	"public_port" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_port_exposures" ADD CONSTRAINT "service_port_exposures_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "service_port_exposures_public_port_unique" ON "service_port_exposures" USING btree ("public_port");--> statement-breakpoint
CREATE UNIQUE INDEX "service_port_exposures_service_container_port_unique" ON "service_port_exposures" USING btree ("service_id","container_port");