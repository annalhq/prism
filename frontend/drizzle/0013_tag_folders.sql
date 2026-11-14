CREATE TABLE "tag_folders" (
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
	CONSTRAINT "tag_folders_vault_id_id_pk" PRIMARY KEY("vault_id","id"),
	CONSTRAINT "revision_sequence_valid" CHECK ("tag_folders"."revision" > 0 AND "tag_folders"."last_seq" >= 0),
	CONSTRAINT "purge_requires_trash" CHECK ("tag_folders"."purged_at" IS NULL OR "tag_folders"."deleted_at" IS NOT NULL),
	CONSTRAINT "tag_folder_position_valid" CHECK ("tag_folders"."position" IS NULL OR "tag_folders"."position" ~ '^[0-9a-z]{0,127}[1-9a-z]$'),
	CONSTRAINT "tag_folder_name_length" CHECK (char_length("tag_folders"."name") BETWEEN 1 AND 64 AND char_length("tag_folders"."normalized_name") BETWEEN 1 AND 256)
);
--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "tag_folders" ADD CONSTRAINT "tag_folders_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tag_folder_name_unique" ON "tag_folders" USING btree ("vault_id","normalized_name") WHERE "tag_folders"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_vault_id_folder_id_tag_folders_vault_id_id_fk" FOREIGN KEY ("vault_id","folder_id") REFERENCES "public"."tag_folders"("vault_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tag_folder_members" ON "tags" USING btree ("vault_id","folder_id");