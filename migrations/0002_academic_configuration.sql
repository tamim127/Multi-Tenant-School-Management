-- Additive academic configuration. All rows remain when archived.
CREATE TABLE academic_presets (
  key text NOT NULL, version integer NOT NULL CHECK(version > 0), institution_type text NOT NULL,
  category text NOT NULL, definition jsonb NOT NULL, PRIMARY KEY(key,version)
);
CREATE TABLE institution_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL, name text NOT NULL, institution_type text NOT NULL,
  archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,code)
);
CREATE TABLE academic_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL, name text NOT NULL, starts_on date, ends_on date,
  archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,code), CHECK(ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);
CREATE TABLE academic_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL, name text NOT NULL, progression_model text NOT NULL
    CHECK(progression_model IN ('class','year','term','semester','credit','competency','hifz')),
  curriculum_code text, configuration jsonb NOT NULL DEFAULT '{}',
  archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,code)
);
CREATE TABLE academic_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL, name text NOT NULL, unit_type text NOT NULL,
  campus_id uuid, parent_id uuid, program_id uuid, session_id uuid,
  sort_order integer NOT NULL DEFAULT 0, configuration jsonb NOT NULL DEFAULT '{}',
  archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,code),
  FOREIGN KEY(tenant_id,campus_id) REFERENCES campuses(tenant_id,id),
  FOREIGN KEY(tenant_id,parent_id) REFERENCES academic_units(tenant_id,id),
  FOREIGN KEY(tenant_id,program_id) REFERENCES academic_programs(tenant_id,id),
  FOREIGN KEY(tenant_id,session_id) REFERENCES academic_sessions(tenant_id,id),
  CHECK(parent_id IS DISTINCT FROM id)
);
CREATE TABLE academic_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  program_id uuid NOT NULL, code text NOT NULL, name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0, configuration jsonb NOT NULL DEFAULT '{}',
  archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,program_id,code),
  FOREIGN KEY(tenant_id,program_id) REFERENCES academic_programs(tenant_id,id)
);
CREATE TABLE academic_level_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  unit_id uuid NOT NULL, level_id uuid NOT NULL,
  archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,unit_id,level_id),
  FOREIGN KEY(tenant_id,unit_id) REFERENCES academic_units(tenant_id,id),
  FOREIGN KEY(tenant_id,level_id) REFERENCES academic_levels(tenant_id,id)
);
CREATE TABLE academic_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  session_id uuid NOT NULL, code text NOT NULL, name text NOT NULL,
  starts_on date, ends_on date, sort_order integer NOT NULL DEFAULT 0,
  archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,session_id,code),
  FOREIGN KEY(tenant_id,session_id) REFERENCES academic_sessions(tenant_id,id),
  CHECK(ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);
CREATE TABLE academic_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  level_id uuid NOT NULL, term_id uuid, code text NOT NULL, name text NOT NULL,
  period_type text NOT NULL CHECK(period_type IN ('class','year','term','semester','custom')),
  sort_order integer NOT NULL DEFAULT 0, archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,level_id,code),
  FOREIGN KEY(tenant_id,level_id) REFERENCES academic_levels(tenant_id,id),
  FOREIGN KEY(tenant_id,term_id) REFERENCES academic_terms(tenant_id,id)
);
CREATE TABLE academic_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  period_id uuid NOT NULL, code text NOT NULL, name text NOT NULL,
  group_type text NOT NULL CHECK(group_type IN ('section','group','batch','custom')),
  archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,period_id,code),
  FOREIGN KEY(tenant_id,period_id) REFERENCES academic_periods(tenant_id,id)
);
CREATE TABLE academic_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  program_id uuid NOT NULL, period_id uuid, code text NOT NULL, name text NOT NULL,
  subject_type text NOT NULL CHECK(subject_type IN ('subject','course')),
  configuration jsonb NOT NULL DEFAULT '{}', archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,program_id,code),
  FOREIGN KEY(tenant_id,program_id) REFERENCES academic_programs(tenant_id,id),
  FOREIGN KEY(tenant_id,period_id) REFERENCES academic_periods(tenant_id,id)
);
CREATE TABLE tenant_preset_applications (
  tenant_id uuid NOT NULL REFERENCES tenants(id), preset_key text NOT NULL, preset_version integer NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,preset_key,preset_version),
  FOREIGN KEY(preset_key,preset_version) REFERENCES academic_presets(key,version)
);

CREATE FUNCTION app.prevent_unit_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE found_cycle boolean;
BEGIN
 IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
 WITH RECURSIVE ancestors(id,parent_id,path) AS (
   SELECT id,parent_id,ARRAY[id] FROM academic_units WHERE tenant_id=NEW.tenant_id AND id=NEW.parent_id
   UNION ALL
   SELECT u.id,u.parent_id,a.path || u.id FROM academic_units u JOIN ancestors a ON u.id=a.parent_id
   WHERE u.tenant_id=NEW.tenant_id AND NOT u.id=ANY(a.path)
 ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE id=NEW.id OR parent_id=NEW.id) INTO found_cycle;
 IF found_cycle THEN RAISE EXCEPTION 'Circular academic unit hierarchy' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER prevent_unit_cycle BEFORE INSERT OR UPDATE OF parent_id ON academic_units
FOR EACH ROW EXECUTE FUNCTION app.prevent_unit_cycle();

-- Recreate the Phase 1 permission function with one additional permission.
CREATE OR REPLACE FUNCTION app.has_permission(target uuid, permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT target = app.tenant_id() AND EXISTS (
   SELECT 1 FROM public.memberships m WHERE m.tenant_id = target AND m.user_id = app.actor_id()
   AND CASE permission
     WHEN 'read' THEN true
     WHEN 'campus:write' THEN m.role IN ('owner','admin')
     WHEN 'membership:write' THEN m.role IN ('owner','admin')
     WHEN 'tenant:write' THEN m.role = 'owner'
     WHEN 'audit:read' THEN m.role IN ('owner','admin')
     WHEN 'academic:write' THEN m.role IN ('owner','admin')
     ELSE false END
 )
$$;
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['institution_categories','academic_sessions','academic_programs','academic_units','academic_levels','academic_level_assignments','academic_terms','academic_periods','academic_groups','academic_subjects','tenant_preset_applications'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
  EXECUTE format('CREATE POLICY academic_read ON %I FOR SELECT USING (app.has_permission(tenant_id,''read''))',table_name);
  IF table_name <> 'tenant_preset_applications' THEN
   EXECUTE format('CREATE POLICY academic_insert ON %I FOR INSERT WITH CHECK (app.has_permission(tenant_id,''academic:write''))',table_name);
   EXECUTE format('CREATE POLICY academic_update ON %I FOR UPDATE USING (app.has_permission(tenant_id,''academic:write'')) WITH CHECK (app.has_permission(tenant_id,''academic:write''))',table_name);
  END IF;
 END LOOP;
END $$;
GRANT SELECT ON academic_presets TO edu_runtime;
GRANT SELECT,INSERT,UPDATE ON institution_categories,academic_sessions,academic_programs,academic_units,academic_levels,academic_level_assignments,academic_terms,academic_periods,academic_groups,academic_subjects TO edu_runtime;
GRANT SELECT ON tenant_preset_applications TO edu_runtime;
-- Inserts into tenant_preset_applications are only via the audited apply function.

INSERT INTO academic_presets(key,version,institution_type,category,definition) VALUES
('kindergarten',1,'school','Kindergarten','{"units":[{"code":"kindergarten","name":"Kindergarten","unitType":"kindergarten","programs":[{"code":"kg","name":"Kindergarten","progressionModel":"class","levels":["Play","Nursery","KG"]}]}]}'),
('primary',1,'school','Primary School','{"units":[{"code":"primary","name":"Primary","unitType":"primary","programs":[{"code":"primary","name":"Primary","progressionModel":"class","levels":["Class 1","Class 2","Class 3","Class 4","Class 5"]}]}]}'),
('secondary',1,'school','Secondary School','{"units":[{"code":"secondary","name":"Secondary","unitType":"secondary","programs":[{"code":"secondary","name":"Secondary","progressionModel":"class","levels":["Class 6","Class 7","Class 8","Class 9","Class 10"]}]}]}'),
('school-college',1,'school','School and College','{"units":[{"code":"school","name":"School","unitType":"school","programs":[{"code":"school","name":"School","progressionModel":"class","levels":["Class 1","Class 2","Class 3","Class 4","Class 5","Class 6","Class 7","Class 8","Class 9","Class 10"]}]},{"code":"college","name":"College","unitType":"college","programs":[{"code":"hsc","name":"HSC","progressionModel":"year","levels":["Class 11","Class 12"]}]}]}'),
('hsc',1,'college','Higher Secondary College','{"units":[{"code":"hsc","name":"Higher Secondary","unitType":"college","programs":[{"code":"hsc","name":"HSC","progressionModel":"year","levels":["Class 11","Class 12"]}]}]}'),
('hsc-degree',1,'college','Degree College','{"units":[{"code":"hsc","name":"HSC","unitType":"college","programs":[{"code":"hsc","name":"HSC","progressionModel":"year","levels":["Class 11","Class 12"]}]},{"code":"degree","name":"Degree","unitType":"degree","programs":[{"code":"degree","name":"Degree","progressionModel":"year","levels":["Year 1","Year 2","Year 3"]}]}]}'),
('hsc-honours-masters',1,'college','Honours College','{"units":[{"code":"hsc","name":"HSC","unitType":"college","programs":[{"code":"hsc","name":"HSC","progressionModel":"year","levels":["Class 11","Class 12"]}]},{"code":"degree","name":"Degree","unitType":"degree","programs":[{"code":"degree","name":"Degree","progressionModel":"year","levels":["Year 1"]}]},{"code":"honours","name":"Honours","unitType":"honours","programs":[{"code":"honours","name":"Honours","progressionModel":"credit","levels":["Undergraduate"]}]},{"code":"masters","name":"Masters","unitType":"masters","programs":[{"code":"masters","name":"Masters","progressionModel":"credit","levels":["Postgraduate"]}]}]}'),
('university',1,'university','University','{"units":[{"code":"undergraduate","name":"Undergraduate","unitType":"degree","programs":[{"code":"undergraduate","name":"Undergraduate","progressionModel":"credit","levels":["Undergraduate"]}]},{"code":"postgraduate","name":"Postgraduate","unitType":"postgraduate","programs":[{"code":"postgraduate","name":"Postgraduate","progressionModel":"credit","levels":["Masters","PhD"]}]}]}'),
('alia-madrasa',1,'madrasa','Alia Madrasa','{"units":[{"code":"alia","name":"Alia","unitType":"alia","programs":[{"code":"alia","name":"Alia","progressionModel":"year","levels":["Dakhil","Alim","Fazil","Kamil"]}]}]}'),
('qawmi-madrasa',1,'madrasa','Qawmi Madrasa','{"units":[{"code":"qawmi","name":"Qawmi","unitType":"qawmi","programs":[{"code":"qawmi","name":"Qawmi","progressionModel":"competency","levels":["Jamat","Marhala"]}]}]}'),
('hifz-madrasa',1,'madrasa','Hifz Madrasa','{"units":[{"code":"hifz","name":"Hifz","unitType":"hifz","programs":[{"code":"hifz","name":"Hifz","progressionModel":"hifz","levels":["Hifz"]}]}]}');

CREATE FUNCTION app.apply_academic_preset(target uuid, preset text, preset_v integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE definition jsonb; unit_item jsonb; program_item jsonb; level_name text; uid uuid; pid uuid; lid uuid; key_text text;
BEGIN
 IF NOT app.has_permission(target,'academic:write') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 SELECT p.definition INTO definition FROM public.academic_presets p WHERE p.key=preset AND p.version=preset_v;
 IF definition IS NULL THEN RAISE EXCEPTION 'Unknown preset' USING ERRCODE='22023'; END IF;
 INSERT INTO public.tenant_preset_applications(tenant_id,preset_key,preset_version) VALUES(target,preset,preset_v) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN false; END IF;
 FOR unit_item IN SELECT value FROM jsonb_array_elements(definition->'units') LOOP
  key_text := unit_item->>'code';
  INSERT INTO public.academic_units(tenant_id,code,name,unit_type) VALUES(target,key_text,unit_item->>'name',unit_item->>'unitType') ON CONFLICT(tenant_id,code) DO NOTHING;
  SELECT id INTO uid FROM public.academic_units WHERE tenant_id=target AND code=key_text;
  FOR program_item IN SELECT value FROM jsonb_array_elements(unit_item->'programs') LOOP
   key_text := program_item->>'code';
   INSERT INTO public.academic_programs(tenant_id,code,name,progression_model) VALUES(target,key_text,program_item->>'name',program_item->>'progressionModel') ON CONFLICT(tenant_id,code) DO NOTHING;
   SELECT id INTO pid FROM public.academic_programs WHERE tenant_id=target AND code=key_text;
   UPDATE public.academic_units SET program_id=pid WHERE tenant_id=target AND id=uid AND program_id IS NULL;
   FOR level_name IN SELECT value #>> '{}' FROM jsonb_array_elements(program_item->'levels') LOOP
    key_text := lower(regexp_replace(level_name,'[^a-zA-Z0-9]+','-','g'));
    INSERT INTO public.academic_levels(tenant_id,program_id,code,name) VALUES(target,pid,key_text,level_name) ON CONFLICT(tenant_id,program_id,code) DO NOTHING;
    SELECT id INTO lid FROM public.academic_levels WHERE tenant_id=target AND program_id=pid AND code=key_text;
    INSERT INTO public.academic_level_assignments(tenant_id,unit_id,level_id) VALUES(target,uid,lid) ON CONFLICT(tenant_id,unit_id,level_id) DO NOTHING;
   END LOOP;
  END LOOP;
 END LOOP;
 INSERT INTO public.audit_events(tenant_id,actor_id,action,request_id) VALUES(target,app.actor_id(),'academic.preset.applied',coalesce(nullif(current_setting('app.request_id',true),''),'system'));
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.apply_academic_preset(uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.apply_academic_preset(uuid,text,integer) TO edu_runtime;
