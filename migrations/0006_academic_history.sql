CREATE TABLE academic_structure_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  resource text NOT NULL, resource_id uuid NOT NULL, prior_row jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE INDEX academic_structure_history_lookup ON academic_structure_history(tenant_id,resource,resource_id,changed_at);
ALTER TABLE academic_structure_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_structure_history FORCE ROW LEVEL SECURITY;
CREATE POLICY academic_history_read ON academic_structure_history FOR SELECT USING (app.has_permission(tenant_id,'read'));
GRANT SELECT ON academic_structure_history TO edu_runtime;
CREATE FUNCTION app.capture_academic_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 INSERT INTO public.academic_structure_history(tenant_id,resource,resource_id,prior_row)
 VALUES(OLD.tenant_id,TG_TABLE_NAME,OLD.id,to_jsonb(OLD));
 RETURN NEW;
END $$;
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['institution_categories','academic_sessions','academic_programs','academic_units','academic_levels','academic_level_assignments','academic_terms','academic_periods','academic_groups','academic_subjects'] LOOP
  EXECUTE format('CREATE TRIGGER capture_academic_history BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app.capture_academic_history()',table_name);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION app.capture_academic_history() FROM PUBLIC;
