CREATE TABLE "spaces" (
	"vault_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"position" text,
	"deleted_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"revision" bigint DEFAULT 1 NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spaces_vault_id_id_pk" PRIMARY KEY("vault_id","id"),
	CONSTRAINT "revision_sequence_valid" CHECK ("spaces"."revision" > 0 AND "spaces"."last_seq" >= 0),
	CONSTRAINT "purge_requires_trash" CHECK ("spaces"."purged_at" IS NULL OR "spaces"."deleted_at" IS NOT NULL),
	CONSTRAINT "space_position_valid" CHECK ("spaces"."position" IS NULL OR "spaces"."position" ~ '^[0-9a-z]{0,127}[1-9a-z]$'),
	CONSTRAINT "space_name_length" CHECK (char_length("spaces"."name") BETWEEN 1 AND 64 AND char_length("spaces"."normalized_name") BETWEEN 1 AND 256)
);
--> statement-breakpoint
ALTER TABLE "tag_folders" ADD COLUMN "space_id" uuid;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "space_id" uuid;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "space_name_unique" ON "spaces" USING btree ("vault_id","normalized_name") WHERE "spaces"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "tag_folders" ADD CONSTRAINT "tag_folders_vault_id_space_id_spaces_vault_id_id_fk" FOREIGN KEY ("vault_id","space_id") REFERENCES "public"."spaces"("vault_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_vault_id_space_id_spaces_vault_id_id_fk" FOREIGN KEY ("vault_id","space_id") REFERENCES "public"."spaces"("vault_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tag_folder_space_members" ON "tag_folders" USING btree ("vault_id","space_id");--> statement-breakpoint
CREATE INDEX "tag_space_members" ON "tags" USING btree ("vault_id","space_id");