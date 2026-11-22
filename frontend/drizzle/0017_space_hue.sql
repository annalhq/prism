ALTER TABLE "spaces" ADD COLUMN "hue" smallint;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "space_hue_valid" CHECK ("spaces"."hue" IS NULL OR "spaces"."hue" BETWEEN 0 AND 359);