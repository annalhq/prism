CREATE TABLE "themes" (
	"vault_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"document" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"position" text,
	"deleted_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"revision" bigint DEFAULT 1 NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "themes_vault_id_id_pk" PRIMARY KEY("vault_id","id"),
	CONSTRAINT "revision_sequence_valid" CHECK ("themes"."revision" > 0 AND "themes"."last_seq" >= 0),
	CONSTRAINT "purge_requires_trash" CHECK ("themes"."purged_at" IS NULL OR "themes"."deleted_at" IS NOT NULL),
	CONSTRAINT "theme_limits" CHECK ("themes"."kind" IN ('theme','module') AND char_length("themes"."name") BETWEEN 1 AND 64 AND octet_length("themes"."document"::text) <= 16384 AND ("themes"."position" IS NULL OR "themes"."position" ~ '^[0-9a-z]{0,127}[1-9a-z]$'))
);
--> statement-breakpoint
CREATE TABLE "vault_appearance" (
	"vault_id" uuid PRIMARY KEY NOT NULL,
	"id" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL,
	"active_theme" text NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revision_sequence_valid" CHECK ("vault_appearance"."revision" > 0 AND "vault_appearance"."last_seq" >= 0),
	CONSTRAINT "vault_appearance_id" CHECK ("vault_appearance"."id" = '00000000-0000-0000-0000-000000000000'),
	CONSTRAINT "vault_appearance_theme" CHECK (char_length("vault_appearance"."active_theme") BETWEEN 1 AND 64)
);
--> statement-breakpoint
ALTER TABLE "themes" ADD CONSTRAINT "themes_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_appearance" ADD CONSTRAINT "vault_appearance_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "theme_name_unique" ON "themes" USING btree ("vault_id","kind","normalized_name") WHERE "themes"."deleted_at" IS NULL;