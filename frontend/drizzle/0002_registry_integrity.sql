-- Registry identity is stable. Lifecycle lives here, not in subtype rows.
CREATE FUNCTION public.prism_immutable_entity_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.vault_id IS DISTINCT FROM OLD.vault_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'knowledge entity identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER prism_entity_identity BEFORE UPDATE ON public.knowledge_entities
FOR EACH ROW EXECUTE FUNCTION public.prism_immutable_entity_identity();
--> statement-breakpoint
-- Deferred validation allows registry/subtype writes in either order within one transaction.
CREATE FUNCTION public.prism_validate_entity_shape() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  entity public.knowledge_entities%ROWTYPE;
  expected_hash text;
  content_url text;
  target_vault uuid;
  target_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_vault := OLD.vault_id; target_id := OLD.id;
  ELSE
    target_vault := NEW.vault_id; target_id := NEW.id;
  END IF;
  SELECT * INTO entity FROM public.knowledge_entities WHERE vault_id = target_vault AND id = target_id;
  IF NOT FOUND OR entity.purged_at IS NOT NULL THEN RETURN NULL; END IF;
  IF entity.kind = 'bookmark' THEN
    SELECT canonical_url INTO content_url FROM public.bookmarks WHERE vault_id = target_vault AND id = target_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'bookmark subtype required' USING ERRCODE = '23514'; END IF;
    expected_hash := CASE WHEN content_url IS NULL THEN NULL ELSE encode(sha256(convert_to(content_url, 'UTF8')), 'hex') END;
    IF expected_hash IS DISTINCT FROM entity.url_hash THEN
      RAISE EXCEPTION 'canonical URL hash does not match registry' USING ERRCODE = '23514';
    END IF;
  ELSIF entity.kind = 'person' THEN
    PERFORM 1 FROM public.people WHERE vault_id = target_vault AND id = target_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'person subtype required' USING ERRCODE = '23514'; END IF;
  ELSE
    PERFORM 1 FROM public.personas WHERE vault_id = target_vault AND id = target_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'persona subtype required' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER prism_registry_shape AFTER INSERT OR UPDATE ON public.knowledge_entities
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.prism_validate_entity_shape();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER prism_bookmark_shape AFTER INSERT OR UPDATE OR DELETE ON public.bookmarks
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.prism_validate_entity_shape();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER prism_person_shape AFTER INSERT OR UPDATE OR DELETE ON public.people
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.prism_validate_entity_shape();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER prism_persona_shape AFTER INSERT OR UPDATE OR DELETE ON public.personas
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.prism_validate_entity_shape();
