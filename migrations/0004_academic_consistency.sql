-- Cross-entity relationships must agree on program even within one tenant.
CREATE FUNCTION app.check_level_assignment_program() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE unit_program uuid; level_program uuid;
BEGIN
 SELECT program_id INTO unit_program FROM academic_units WHERE tenant_id=NEW.tenant_id AND id=NEW.unit_id;
 SELECT program_id INTO level_program FROM academic_levels WHERE tenant_id=NEW.tenant_id AND id=NEW.level_id;
 IF unit_program IS NOT NULL AND unit_program IS DISTINCT FROM level_program THEN
   RAISE EXCEPTION 'Unit and level programs differ' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER check_level_assignment_program BEFORE INSERT OR UPDATE OF unit_id,level_id
ON academic_level_assignments FOR EACH ROW EXECUTE FUNCTION app.check_level_assignment_program();

CREATE FUNCTION app.check_subject_period_program() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE period_program uuid;
BEGIN
 IF NEW.period_id IS NULL THEN RETURN NEW; END IF;
 SELECT l.program_id INTO period_program FROM academic_periods p
 JOIN academic_levels l ON l.tenant_id=p.tenant_id AND l.id=p.level_id
 WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.period_id;
 IF period_program IS NOT NULL AND period_program IS DISTINCT FROM NEW.program_id THEN
   RAISE EXCEPTION 'Subject and period programs differ' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER check_subject_period_program BEFORE INSERT OR UPDATE OF program_id,period_id
ON academic_subjects FOR EACH ROW EXECUTE FUNCTION app.check_subject_period_program();

CREATE FUNCTION app.prevent_assigned_program_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.program_id IS DISTINCT FROM OLD.program_id AND
    ((TG_TABLE_NAME='academic_units' AND EXISTS(SELECT 1 FROM academic_level_assignments WHERE tenant_id=OLD.tenant_id AND unit_id=OLD.id)) OR
     (TG_TABLE_NAME='academic_levels' AND EXISTS(SELECT 1 FROM academic_level_assignments WHERE tenant_id=OLD.tenant_id AND level_id=OLD.id)) OR
     (TG_TABLE_NAME='academic_levels' AND EXISTS(SELECT 1 FROM academic_periods WHERE tenant_id=OLD.tenant_id AND level_id=OLD.id))) THEN
   RAISE EXCEPTION 'Program cannot change while referenced' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER prevent_unit_program_change BEFORE UPDATE OF program_id ON academic_units
FOR EACH ROW EXECUTE FUNCTION app.prevent_assigned_program_change();
CREATE TRIGGER prevent_level_program_change BEFORE UPDATE OF program_id ON academic_levels
FOR EACH ROW EXECUTE FUNCTION app.prevent_assigned_program_change();
