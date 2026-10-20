ALTER TABLE "attachments" ADD CONSTRAINT "revision_sequence_valid" CHECK ("attachments"."revision" > 0 AND "attachments"."last_seq" >= 0);--> statement-breakpoint
ALTER TABLE "bookmark_activity" ADD CONSTRAINT "revision_sequence_valid" CHECK ("bookmark_activity"."revision" > 0 AND "bookmark_activity"."last_seq" >= 0);--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "revision_sequence_valid" CHECK ("collections"."revision" > 0 AND "collections"."last_seq" >= 0);--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "purge_requires_trash" CHECK ("collections"."purged_at" IS NULL OR "collections"."deleted_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "content_people" ADD CONSTRAINT "revision_sequence_valid" CHECK ("content_people"."revision" > 0 AND "content_people"."last_seq" >= 0);--> statement-breakpoint
ALTER TABLE "content_people" ADD CONSTRAINT "purge_requires_trash" CHECK ("content_people"."purged_at" IS NULL OR "content_people"."deleted_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "person_identities" ADD CONSTRAINT "revision_sequence_valid" CHECK ("person_identities"."revision" > 0 AND "person_identities"."last_seq" >= 0);--> statement-breakpoint
ALTER TABLE "person_identities" ADD CONSTRAINT "purge_requires_trash" CHECK ("person_identities"."purged_at" IS NULL OR "person_identities"."deleted_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "persona_members" ADD CONSTRAINT "revision_sequence_valid" CHECK ("persona_members"."revision" > 0 AND "persona_members"."last_seq" >= 0);--> statement-breakpoint
ALTER TABLE "persona_members" ADD CONSTRAINT "purge_requires_trash" CHECK ("persona_members"."purged_at" IS NULL OR "persona_members"."deleted_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "revision_sequence_valid" CHECK ("saved_searches"."revision" > 0 AND "saved_searches"."last_seq" >= 0);--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "purge_requires_trash" CHECK ("saved_searches"."purged_at" IS NULL OR "saved_searches"."deleted_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "revision_sequence_valid" CHECK ("tags"."revision" > 0 AND "tags"."last_seq" >= 0);--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "purge_requires_trash" CHECK ("tags"."purged_at" IS NULL OR "tags"."deleted_at" IS NOT NULL);