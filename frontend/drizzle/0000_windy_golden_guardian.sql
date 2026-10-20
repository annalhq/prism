CREATE TYPE "public"."attachment_state" AS ENUM('ready', 'deleted', 'purged');--> statement-breakpoint
CREATE TYPE "public"."bookmark_kind" AS ENUM('page', 'social', 'image');--> statement-breakpoint
CREATE TYPE "public"."entity_kind" AS ENUM('bookmark', 'person', 'persona');--> statement-breakpoint
CREATE TYPE "public"."job_state" AS ENUM('pending', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."link_kind" AS ENUM('note_reference', 'related');--> statement-breakpoint
CREATE TYPE "public"."person_role" AS ENUM('author', 'about', 'related');--> statement-breakpoint
CREATE TYPE "public"."reading_status" AS ENUM('unread', 'reading', 'read');--> statement-breakpoint
CREATE TYPE "public"."relation_provenance" AS ENUM('manual', 'capture_confirmed');--> statement-breakpoint
CREATE TYPE "public"."upload_state" AS ENUM('pending', 'verifying', 'ready', 'failed', 'expired');--> statement-breakpoint
CREATE TABLE "attachments" (
	"vault_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"bookmark_id" uuid NOT NULL,
	"object_key" text,
	"object_version" text,
	"thumbnail_key" text,
	"thumbnail_version" text,
	"mime" text,
	"bytes" bigint,
	"width" integer,
	"height" integer,
	"sha256" text,
	"state" "attachment_state" DEFAULT 'ready' NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_vault_id_id_pk" PRIMARY KEY("vault_id","id"),
	CONSTRAINT "ready_attachment_verified" CHECK ("attachments"."state" <> 'ready' OR ("attachments"."object_key" IS NOT NULL AND "attachments"."object_version" IS NOT NULL AND "attachments"."mime" IS NOT NULL AND "attachments"."bytes" IS NOT NULL AND "attachments"."width" IS NOT NULL AND "attachments"."height" IS NOT NULL AND "attachments"."sha256" IS NOT NULL AND "attachments"."mime" IN ('image/jpeg','image/png','image/webp') AND "attachments"."bytes" > 0 AND "attachments"."bytes" <= 20971520 AND "attachments"."width" > 0 AND "attachments"."height" > 0 AND "attachments"."width"::bigint * "attachments"."height"::bigint <= 40000000 AND "attachments"."sha256" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "attachment_thumbnail_pair" CHECK (("attachments"."thumbnail_key" IS NULL) = ("attachments"."thumbnail_version" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "bookmark_activity" (
	"vault_id" uuid NOT NULL,
	"bookmark_id" uuid NOT NULL,
	"last_opened_at" timestamp with time zone NOT NULL,
	"open_count" bigint DEFAULT 1 NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookmark_activity_vault_id_bookmark_id_pk" PRIMARY KEY("vault_id","bookmark_id"),
	CONSTRAINT "activity_count_valid" CHECK ("bookmark_activity"."open_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "bookmarks" (
	"vault_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"entity_kind" "entity_kind" DEFAULT 'bookmark' NOT NULL,
	"kind" "bookmark_kind" DEFAULT 'page' NOT NULL,
	"url" text,
	"canonical_url" text,
	"domain" text,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"collection_id" uuid,
	"reading_status" "reading_status" DEFAULT 'unread' NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookmarks_vault_id_id_pk" PRIMARY KEY("vault_id","id"),
	CONSTRAINT "bookmark_entity_kind" CHECK ("bookmarks"."entity_kind" = 'bookmark'),
	CONSTRAINT "bookmark_title_length" CHECK (char_length("bookmarks"."title") BETWEEN 1 AND 500),
	CONSTRAINT "bookmark_description_length" CHECK (char_length("bookmarks"."description") <= 10000),
	CONSTRAINT "bookmark_url_required" CHECK ("bookmarks"."kind" = 'image' OR ("bookmarks"."url" IS NOT NULL AND "bookmarks"."canonical_url" IS NOT NULL)),
	CONSTRAINT "bookmark_url_safe" CHECK (("bookmarks"."url" IS NULL OR (char_length("bookmarks"."url") <= 8192 AND "bookmarks"."url" ~* '^https?://[^/?#@[:space:]]+([/?#]|$)')) AND ("bookmarks"."canonical_url" IS NULL OR (char_length("bookmarks"."canonical_url") <= 8192 AND "bookmarks"."canonical_url" ~* '^https?://[^/?#@[:space:]]+([/?#]|$)')))
);
--> statement-breakpoint
CREATE TABLE "change_log" (
	"vault_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"frame" jsonb NOT NULL,
	"protocol_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_log_vault_id_seq_pk" PRIMARY KEY("vault_id","seq"),
	CONSTRAINT "change_frame_limits" CHECK ("change_log"."seq" > 0 AND "change_log"."protocol_version" > 0 AND octet_length("change_log"."frame"::text) <= 1048576)
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"vault_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"revision" bigint DEFAULT 1 NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collections_vault_id_id_pk" PRIMARY KEY("vault_id","id"),
	CONSTRAINT "collection_name_length" CHECK (char_length("collections"."name") BETWEEN 1 AND 64 AND char_length("collections"."normalized_name") BETWEEN 1 AND 256)
);
--> statement-breakpoint
CREATE TABLE "content_people" (
	"vault_id" uuid NOT NULL,
	"bookmark_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" "person_role" NOT NULL,
	"provenance" "relation_provenance" NOT NULL,
	"deleted_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"revision" bigint DEFAULT 1 NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_people_vault_id_bookmark_id_person_id_role_pk" PRIMARY KEY("vault_id","bookmark_id","person_id","role")
);
--> statement-breakpoint
CREATE TABLE "device_tokens" (
	"vault_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_tokens_vault_id_id_pk" PRIMARY KEY("vault_id","id"),
	CONSTRAINT "device_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "device_token_hash_valid" CHECK ("device_tokens"."token_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "knowledge_entities" (
	"vault_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"kind" "entity_kind" NOT NULL,
	"url_hash" text,
	"persona_name" text,
	"deleted_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"revision" bigint DEFAULT 1 NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_entities_vault_id_id_pk" PRIMARY KEY("vault_id","id"),
	CONSTRAINT "entity_identity_kind" UNIQUE("vault_id","id","kind"),
	CONSTRAINT "entity_persona_name_valid" CHECK (("knowledge_entities"."kind" = 'persona' AND char_length("knowledge_entities"."persona_name") BETWEEN 1 AND 256 AND "knowledge_entities"."persona_name" IS NOT NULL) OR ("knowledge_entities"."kind" <> 'persona' AND "knowledge_entities"."persona_name" IS NULL)),
	CONSTRAINT "entity_hash_valid" CHECK ("knowledge_entities"."url_hash" IS NULL OR ("knowledge_entities"."kind" = 'bookmark' AND "knowledge_entities"."url_hash" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "entity_revision_valid" CHECK ("knowledge_entities"."revision" > 0 AND "knowledge_entities"."last_seq" >= 0),
	CONSTRAINT "entity_purge_requires_trash" CHECK ("knowledge_entities"."purged_at" IS NULL OR "knowledge_entities"."deleted_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "entity_links" (
	"vault_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"kind" "link_kind" NOT NULL,
	CONSTRAINT "entity_links_vault_id_source_id_target_id_kind_pk" PRIMARY KEY("vault_id","source_id","target_id","kind")
);
--> statement-breakpoint
CREATE TABLE "entity_tags" (
	"vault_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "entity_tags_vault_id_entity_id_tag_id_pk" PRIMARY KEY("vault_id","entity_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "maintenance_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"deduplication_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"state" "job_state" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_deduplication" UNIQUE("vault_id","deduplication_key"),
	CONSTRAINT "job_attempts_valid" CHECK ("maintenance_jobs"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mutation_receipts" (
	"vault_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mutation_receipts_vault_id_operation_id_pk" PRIMARY KEY("vault_id","operation_id"),
	CONSTRAINT "receipt_hash_valid" CHECK ("mutation_receipts"."request_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "note_revisions" (
	"vault_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"revision" bigint NOT NULL,
	"body_markdown" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_revisions_vault_id_entity_id_revision_pk" PRIMARY KEY("vault_id","entity_id","revision"),
	CONSTRAINT "note_history_body_limit" CHECK (octet_length("note_revisions"."body_markdown") <= 102400 AND "note_revisions"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "entity_notes" (
	"vault_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"body_markdown" text DEFAULT '' NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_notes_vault_id_entity_id_pk" PRIMARY KEY("vault_id","entity_id"),
	CONSTRAINT "note_body_limit" CHECK (octet_length("entity_notes"."body_markdown") <= 102400),
	CONSTRAINT "note_revision_valid" CHECK ("entity_notes"."revision" > 0 AND "entity_notes"."last_seq" >= 0)
);
--> statement-breakpoint
CREATE TABLE "people" (
	"vault_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"entity_kind" "entity_kind" DEFAULT 'person' NOT NULL,
	"display_name" text NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"website" text,
	CONSTRAINT "people_vault_id_id_pk" PRIMARY KEY("vault_id","id"),
	CONSTRAINT "person_entity_kind" CHECK ("people"."entity_kind" = 'person'),
	CONSTRAINT "person_text_limits" CHECK (char_length("people"."display_name") BETWEEN 1 AND 200 AND char_length("people"."bio") <= 10000)
);
--> statement-breakpoint
CREATE TABLE "person_identities" (
	"vault_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"native_account_id" text,
	"profile_url" text NOT NULL,
	"profile_url_hash" text NOT NULL,
	"handle" text,
	"deleted_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"revision" bigint DEFAULT 1 NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_identities_vault_id_id_pk" PRIMARY KEY("vault_id","id"),
	CONSTRAINT "profile_identity_limits" CHECK (char_length("person_identities"."platform") BETWEEN 1 AND 64 AND ("person_identities"."native_account_id" IS NULL OR char_length("person_identities"."native_account_id") BETWEEN 1 AND 256) AND "person_identities"."profile_url_hash" ~ '^[a-f0-9]{64}$' AND char_length("person_identities"."profile_url") <= 8192)
);
--> statement-breakpoint
CREATE TABLE "persona_members" (
	"vault_id" uuid NOT NULL,
	"persona_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"member_kind" "entity_kind" NOT NULL,
	"deleted_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"revision" bigint DEFAULT 1 NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persona_members_vault_id_persona_id_member_id_pk" PRIMARY KEY("vault_id","persona_id","member_id"),
	CONSTRAINT "persona_member_not_nested" CHECK ("persona_members"."member_kind" IN ('bookmark', 'person'))
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"vault_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"entity_kind" "entity_kind" DEFAULT 'persona' NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	CONSTRAINT "personas_vault_id_id_pk" PRIMARY KEY("vault_id","id"),
	CONSTRAINT "persona_entity_kind" CHECK ("personas"."entity_kind" = 'persona'),
	CONSTRAINT "persona_text_limits" CHECK (char_length("personas"."name") BETWEEN 1 AND 64 AND char_length("personas"."description") <= 10000)
);
--> statement-breakpoint
CREATE TABLE "saved_searches" (
	"vault_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"filter" jsonb NOT NULL,
	"ast_version" integer DEFAULT 1 NOT NULL,
	"sort" text DEFAULT 'newest' NOT NULL,
	"deleted_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"revision" bigint DEFAULT 1 NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_searches_vault_id_id_pk" PRIMARY KEY("vault_id","id"),
	CONSTRAINT "saved_search_limits" CHECK (char_length("saved_searches"."name") BETWEEN 1 AND 64 AND "saved_searches"."ast_version" > 0 AND "saved_searches"."sort" IN ('newest','title','recently_opened') AND octet_length("saved_searches"."filter"::text) <= 16384)
);
--> statement-breakpoint
CREATE TABLE "sync_leases" (
	"vault_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"start_seq" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sync_leases_vault_id_token_hash_pk" PRIMARY KEY("vault_id","token_hash"),
	CONSTRAINT "lease_sequence_valid" CHECK ("sync_leases"."start_seq" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"vault_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"revision" bigint DEFAULT 1 NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_vault_id_id_pk" PRIMARY KEY("vault_id","id"),
	CONSTRAINT "tag_name_length" CHECK (char_length("tags"."name") BETWEEN 1 AND 64 AND char_length("tags"."normalized_name") BETWEEN 1 AND 256)
);
--> statement-breakpoint
CREATE TABLE "upload_intents" (
	"vault_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"bookmark_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"declared_mime" text NOT NULL,
	"declared_bytes" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"state" "upload_state" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_intents_vault_id_id_pk" PRIMARY KEY("vault_id","id"),
	CONSTRAINT "upload_intents_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "upload_limits" CHECK ("upload_intents"."declared_bytes" > 0 AND "upload_intents"."declared_bytes" <= 20971520 AND "upload_intents"."declared_mime" IN ('image/jpeg','image/png','image/webp'))
);
--> statement-breakpoint
CREATE TABLE "vaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_subject" text NOT NULL,
	"change_seq" bigint DEFAULT 0 NOT NULL,
	"retention_floor" bigint DEFAULT 0 NOT NULL,
	"sync_epoch" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vaults_owner_subject_unique" UNIQUE("owner_subject"),
	CONSTRAINT "vault_sequences_valid" CHECK ("vaults"."change_seq" >= "vaults"."retention_floor" AND "vaults"."retention_floor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_vault_id_bookmark_id_bookmarks_vault_id_id_fk" FOREIGN KEY ("vault_id","bookmark_id") REFERENCES "public"."bookmarks"("vault_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmark_activity" ADD CONSTRAINT "bookmark_activity_vault_id_bookmark_id_bookmarks_vault_id_id_fk" FOREIGN KEY ("vault_id","bookmark_id") REFERENCES "public"."bookmarks"("vault_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_vault_id_id_entity_kind_knowledge_entities_vault_id_id_kind_fk" FOREIGN KEY ("vault_id","id","entity_kind") REFERENCES "public"."knowledge_entities"("vault_id","id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_vault_id_collection_id_collections_vault_id_id_fk" FOREIGN KEY ("vault_id","collection_id") REFERENCES "public"."collections"("vault_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_people" ADD CONSTRAINT "content_people_vault_id_bookmark_id_bookmarks_vault_id_id_fk" FOREIGN KEY ("vault_id","bookmark_id") REFERENCES "public"."bookmarks"("vault_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_people" ADD CONSTRAINT "content_people_vault_id_person_id_people_vault_id_id_fk" FOREIGN KEY ("vault_id","person_id") REFERENCES "public"."people"("vault_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_entities" ADD CONSTRAINT "knowledge_entities_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_vault_id_source_id_knowledge_entities_vault_id_id_fk" FOREIGN KEY ("vault_id","source_id") REFERENCES "public"."knowledge_entities"("vault_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_vault_id_target_id_knowledge_entities_vault_id_id_fk" FOREIGN KEY ("vault_id","target_id") REFERENCES "public"."knowledge_entities"("vault_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_tags" ADD CONSTRAINT "entity_tags_vault_id_entity_id_knowledge_entities_vault_id_id_fk" FOREIGN KEY ("vault_id","entity_id") REFERENCES "public"."knowledge_entities"("vault_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_tags" ADD CONSTRAINT "entity_tags_vault_id_tag_id_tags_vault_id_id_fk" FOREIGN KEY ("vault_id","tag_id") REFERENCES "public"."tags"("vault_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_jobs" ADD CONSTRAINT "maintenance_jobs_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutation_receipts" ADD CONSTRAINT "mutation_receipts_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_vault_id_entity_id_entity_notes_vault_id_entity_id_fk" FOREIGN KEY ("vault_id","entity_id") REFERENCES "public"."entity_notes"("vault_id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_notes" ADD CONSTRAINT "entity_notes_vault_id_entity_id_knowledge_entities_vault_id_id_fk" FOREIGN KEY ("vault_id","entity_id") REFERENCES "public"."knowledge_entities"("vault_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_vault_id_id_entity_kind_knowledge_entities_vault_id_id_kind_fk" FOREIGN KEY ("vault_id","id","entity_kind") REFERENCES "public"."knowledge_entities"("vault_id","id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_identities" ADD CONSTRAINT "person_identities_vault_id_person_id_people_vault_id_id_fk" FOREIGN KEY ("vault_id","person_id") REFERENCES "public"."people"("vault_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_members" ADD CONSTRAINT "persona_members_vault_id_persona_id_personas_vault_id_id_fk" FOREIGN KEY ("vault_id","persona_id") REFERENCES "public"."personas"("vault_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_members" ADD CONSTRAINT "persona_members_vault_id_member_id_member_kind_knowledge_entities_vault_id_id_kind_fk" FOREIGN KEY ("vault_id","member_id","member_kind") REFERENCES "public"."knowledge_entities"("vault_id","id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_vault_id_id_entity_kind_knowledge_entities_vault_id_id_kind_fk" FOREIGN KEY ("vault_id","id","entity_kind") REFERENCES "public"."knowledge_entities"("vault_id","id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_leases" ADD CONSTRAINT "sync_leases_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_vault_id_bookmark_id_bookmarks_vault_id_id_fk" FOREIGN KEY ("vault_id","bookmark_id") REFERENCES "public"."bookmarks"("vault_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookmark_attachments" ON "attachments" USING btree ("vault_id","bookmark_id","id");--> statement-breakpoint
CREATE INDEX "recent_activity" ON "bookmark_activity" USING btree ("vault_id","last_opened_at" DESC NULLS LAST,"bookmark_id");--> statement-breakpoint
CREATE INDEX "bookmark_recent" ON "bookmarks" USING btree ("vault_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "bookmark_collection" ON "bookmarks" USING btree ("vault_id","collection_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "change_retention" ON "change_log" USING btree ("vault_id","created_at","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_name_unique" ON "collections" USING btree ("vault_id","normalized_name") WHERE "collections"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "person_content_feed" ON "content_people" USING btree ("vault_id","person_id","role","bookmark_id");--> statement-breakpoint
CREATE UNIQUE INDEX "active_bookmark_url_unique" ON "knowledge_entities" USING btree ("vault_id","url_hash") WHERE "knowledge_entities"."deleted_at" IS NULL AND "knowledge_entities"."url_hash" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "active_persona_name_unique" ON "knowledge_entities" USING btree ("vault_id","persona_name") WHERE "knowledge_entities"."deleted_at" IS NULL AND "knowledge_entities"."kind" = 'persona';--> statement-breakpoint
CREATE INDEX "backlinks" ON "entity_links" USING btree ("vault_id","target_id","kind","source_id");--> statement-breakpoint
CREATE INDEX "tag_members" ON "entity_tags" USING btree ("vault_id","tag_id","entity_id");--> statement-breakpoint
CREATE INDEX "jobs_due" ON "maintenance_jobs" USING btree ("state","run_after");--> statement-breakpoint
CREATE UNIQUE INDEX "external_profile_unique" ON "person_identities" USING btree ("vault_id","profile_url_hash") WHERE "person_identities"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "external_native_identity_unique" ON "person_identities" USING btree ("vault_id","platform","native_account_id") WHERE "person_identities"."deleted_at" IS NULL AND "person_identities"."native_account_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "member_personas" ON "persona_members" USING btree ("vault_id","member_id","persona_id");--> statement-breakpoint
CREATE INDEX "lease_expiry" ON "sync_leases" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_name_unique" ON "tags" USING btree ("vault_id","normalized_name") WHERE "tags"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "upload_expiry" ON "upload_intents" USING btree ("state","expires_at");