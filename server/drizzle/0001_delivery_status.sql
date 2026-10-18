ALTER TYPE "public"."message_status" ADD VALUE IF NOT EXISTS 'DELIVERY_PENDING' AFTER 'SENDING';--> statement-breakpoint
ALTER TYPE "public"."message_status" ADD VALUE IF NOT EXISTS 'DELIVERED' AFTER 'SENT';
