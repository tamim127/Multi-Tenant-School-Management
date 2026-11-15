-- The Phase 1 preset snapshot stays immutable; current academic type is separate.
ALTER TABLE tenants ADD COLUMN institution_type text NOT NULL DEFAULT 'school';
CREATE FUNCTION app.set_institution_type_from_preset() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE next_type text; current_type text; prior_count integer;
BEGIN
 SELECT institution_type INTO next_type FROM public.academic_presets WHERE key=NEW.preset_key AND version=NEW.preset_version;
 SELECT institution_type INTO current_type FROM public.tenants WHERE id=NEW.tenant_id;
 SELECT count(*) INTO prior_count FROM public.tenant_preset_applications WHERE tenant_id=NEW.tenant_id AND (preset_key,preset_version)<>(NEW.preset_key,NEW.preset_version);
 UPDATE public.tenants SET institution_type=CASE
   WHEN prior_count=0 THEN next_type
   WHEN current_type=next_type THEN current_type
   ELSE 'combined' END
 WHERE id=NEW.tenant_id;
 RETURN NEW;
END $$;
CREATE TRIGGER set_institution_type_from_preset AFTER INSERT ON tenant_preset_applications
FOR EACH ROW EXECUTE FUNCTION app.set_institution_type_from_preset();
REVOKE ALL ON FUNCTION app.set_institution_type_from_preset() FROM PUBLIC;
