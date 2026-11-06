ALTER TABLE "webhook_deliveries" ADD COLUMN "locked_by" text;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "webhook_deliveries_claim_idx" ON "webhook_deliveries" USING btree ("next_attempt_at","id","locked_until") WHERE "webhook_deliveries"."status" = 'pending';