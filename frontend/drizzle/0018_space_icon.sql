ALTER TABLE "spaces" DROP CONSTRAINT "space_hue_valid";--> statement-breakpoint
ALTER TABLE "spaces" DROP COLUMN "hue";--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "space_icon_valid" CHECK ("spaces"."icon" IS NULL OR (char_length("spaces"."icon") <= 64 AND "spaces"."icon" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'));