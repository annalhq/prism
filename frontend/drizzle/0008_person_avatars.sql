CREATE TABLE "person_avatars" (
	"vault_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"handle" text NOT NULL,
	"state" text NOT NULL,
	"object_key" text,
	"mime" text,
	"bytes" integer,
	"sha256" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_avatars_vault_id_person_id_pk" PRIMARY KEY("vault_id","person_id"),
	CONSTRAINT "person_avatar_valid" CHECK (char_length("person_avatars"."handle") BETWEEN 1 AND 15 AND "person_avatars"."handle" ~ '^[a-z0-9_]+$' AND (
				("person_avatars"."state" = 'missing' AND "person_avatars"."object_key" IS NULL) OR
				("person_avatars"."state" = 'stored' AND "person_avatars"."object_key" IS NOT NULL AND "person_avatars"."mime" IN ('image/jpeg','image/png','image/webp')
					AND "person_avatars"."bytes" > 0 AND "person_avatars"."bytes" <= 2097152 AND "person_avatars"."sha256" ~ '^[a-f0-9]{64}$')
			))
);
