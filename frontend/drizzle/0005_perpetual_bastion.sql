CREATE TABLE "extension_pairings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extension_pairings_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "extension_pairing_hash_valid" CHECK ("extension_pairings"."code_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "device_tokens" ALTER COLUMN "expires_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD COLUMN "name" text DEFAULT 'Device' NOT NULL;--> statement-breakpoint
ALTER TABLE "extension_pairings" ADD CONSTRAINT "extension_pairings_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extension_pairing_expiry" ON "extension_pairings" USING btree ("expires_at");