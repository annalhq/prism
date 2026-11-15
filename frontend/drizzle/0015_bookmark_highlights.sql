CREATE TABLE "bookmark_highlights" (
	"vault_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"bookmark_id" uuid NOT NULL,
	"text" text NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"suffix" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookmark_highlights_vault_id_id_pk" PRIMARY KEY("vault_id","id"),
	CONSTRAINT "bookmark_highlight_lengths" CHECK (char_length("bookmark_highlights"."text") BETWEEN 1 AND 5000 AND char_length("bookmark_highlights"."prefix") <= 64 AND char_length("bookmark_highlights"."suffix") <= 64)
);
--> statement-breakpoint
ALTER TABLE "bookmark_highlights" ADD CONSTRAINT "bookmark_highlights_vault_id_bookmark_id_bookmarks_vault_id_id_fk" FOREIGN KEY ("vault_id","bookmark_id") REFERENCES "public"."bookmarks"("vault_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookmark_highlights_bookmark" ON "bookmark_highlights" USING btree ("vault_id","bookmark_id","created_at");