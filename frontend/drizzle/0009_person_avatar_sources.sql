ALTER TABLE "person_avatars" DROP CONSTRAINT "person_avatar_valid";--> statement-breakpoint
-- Existing rows are X photos keyed by the bare handle; key them as x:<handle> so they stay valid
-- and aren't fetched again.
UPDATE "person_avatars" SET "handle" = 'x:' || "handle" WHERE "handle" NOT LIKE '%:%';--> statement-breakpoint
ALTER TABLE "person_avatars" ADD CONSTRAINT "person_avatar_valid" CHECK (char_length("person_avatars"."handle") BETWEEN 3 AND 80 AND "person_avatars"."handle" ~ '^(x|github|youtube|codeforces|bilibili):[A-Za-z0-9._-]{1,64}$' AND (
				("person_avatars"."state" = 'missing' AND "person_avatars"."object_key" IS NULL) OR
				("person_avatars"."state" = 'stored' AND "person_avatars"."object_key" IS NOT NULL AND "person_avatars"."mime" IN ('image/jpeg','image/png','image/webp')
					AND "person_avatars"."bytes" > 0 AND "person_avatars"."bytes" <= 2097152 AND "person_avatars"."sha256" ~ '^[a-f0-9]{64}$')
			));