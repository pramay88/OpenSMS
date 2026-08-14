CREATE TYPE "public"."message_status" AS ENUM('QUEUED', 'ASSIGNED', 'SENDING', 'SENT', 'FAILED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."gateway_status" AS ENUM('ONLINE', 'OFFLINE', 'PAUSED', 'REVOKED');--> statement-breakpoint
CREATE TABLE "api_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"api_key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "registration_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "gateways" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"secret_hash" text NOT NULL,
	"status" "gateway_status" DEFAULT 'OFFLINE' NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"app_version" text,
	"capabilities" text,
	"sim_info" text,
	"network_info" text,
	"active_job_count" integer DEFAULT 0 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"to" text NOT NULL,
	"body" text NOT NULL,
	"status" "message_status" DEFAULT 'QUEUED' NOT NULL,
	"idempotency_key" text,
	"gateway_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"assigned_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"claim_expires_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"attempt_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"from_status" "message_status",
	"to_status" "message_status" NOT NULL,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket_key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_client_id_api_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."api_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_gateway_id_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."gateways"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_events" ADD CONSTRAINT "message_events_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_client_idempotency_idx" ON "messages" USING btree ("client_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "messages_status_expires_idx" ON "messages" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "messages_gateway_status_idx" ON "messages" USING btree ("gateway_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_bucket_key_window_idx" ON "rate_limit_buckets" USING btree ("bucket_key","window_start");
