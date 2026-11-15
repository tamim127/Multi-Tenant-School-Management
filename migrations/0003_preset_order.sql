-- Preserve the array order from a preset and never modify pre-existing tenant units.
CREATE OR REPLACE FUNCTION app.apply_academic_preset(target uuid, preset text, preset_v integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE definition jsonb; unit_item jsonb; program_item jsonb; level_name text; uid uuid; pid uuid; lid uuid; key_text text; unit_created boolean; level_order integer;
BEGIN
 IF NOT app.has_permission(target,'academic:write') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 SELECT p.definition INTO definition FROM public.academic_presets p WHERE p.key=preset AND p.version=preset_v;
 IF definition IS NULL THEN RAISE EXCEPTION 'Unknown preset' USING ERRCODE='22023'; END IF;
 INSERT INTO public.tenant_preset_applications(tenant_id,preset_key,preset_version) VALUES(target,preset,preset_v) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN false; END IF;
 FOR unit_item IN SELECT value FROM jsonb_array_elements(definition->'units') LOOP
  key_text := unit_item->>'code';
  INSERT INTO public.academic_units(tenant_id,code,name,unit_type) VALUES(target,key_text,unit_item->>'name',unit_item->>'unitType') ON CONFLICT(tenant_id,code) DO NOTHING RETURNING id INTO uid;
  unit_created := uid IS NOT NULL;
  IF NOT unit_created THEN SELECT id INTO uid FROM public.academic_units WHERE tenant_id=target AND code=key_text; END IF;
  FOR program_item IN SELECT value FROM jsonb_array_elements(unit_item->'programs') LOOP
   key_text := program_item->>'code';
   INSERT INTO public.academic_programs(tenant_id,code,name,progression_model) VALUES(target,key_text,program_item->>'name',program_item->>'progressionModel') ON CONFLICT(tenant_id,code) DO NOTHING;
   SELECT id INTO pid FROM public.academic_programs WHERE tenant_id=target AND code=key_text;
   IF unit_created THEN UPDATE public.academic_units SET program_id=pid WHERE tenant_id=target AND id=uid AND program_id IS NULL; END IF;
   level_order := 0;
   FOR level_name IN SELECT value #>> '{}' FROM jsonb_array_elements(program_item->'levels') LOOP
    key_text := lower(regexp_replace(level_name,'[^a-zA-Z0-9]+','-','g'));
    INSERT INTO public.academic_levels(tenant_id,program_id,code,name,sort_order) VALUES(target,pid,key_text,level_name,level_order) ON CONFLICT(tenant_id,program_id,code) DO NOTHING;
    SELECT id INTO lid FROM public.academic_levels WHERE tenant_id=target AND program_id=pid AND code=key_text;
    INSERT INTO public.academic_level_assignments(tenant_id,unit_id,level_id) VALUES(target,uid,lid) ON CONFLICT(tenant_id,unit_id,level_id) DO NOTHING;
    level_order := level_order + 1;
   END LOOP;
  END LOOP;
 END LOOP;
 INSERT INTO public.audit_events(tenant_id,actor_id,action,request_id) VALUES(target,app.actor_id(),'academic.preset.applied',coalesce(nullif(current_setting('app.request_id',true),''),'system'));
 RETURN true;
END $$;
