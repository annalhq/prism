ALTER TYPE "public"."bookmark_kind" ADD VALUE 'stash';--> statement-breakpoint
ALTER TABLE "bookmarks" DROP CONSTRAINT "bookmark_url_required";--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmark_url_required" CHECK ("bookmarks"."kind"::text IN ('image', 'text', 'stash') OR ("bookmarks"."url" IS NOT NULL AND "bookmarks"."canonical_url" IS NOT NULL));