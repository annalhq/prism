ALTER TYPE "public"."bookmark_kind" ADD VALUE 'text';--> statement-breakpoint
ALTER TABLE "bookmarks" DROP CONSTRAINT "bookmark_url_required";--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmark_url_required" CHECK ("bookmarks"."kind"::text IN ('image', 'text') OR ("bookmarks"."url" IS NOT NULL AND "bookmarks"."canonical_url" IS NOT NULL));