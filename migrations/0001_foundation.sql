CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app, public TO edu_runtime;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  display_name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  preset_key text NOT NULL CHECK (preset_key = 'school'),
  preset_version integer NOT NULL CHECK (preset_version = 1),
  settings jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE campuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, id), UNIQUE(tenant_id, code)
);
CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  campus_id uuid,
  role text NOT NULL CHECK (role IN ('owner','admin','staff','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, user_id), UNIQUE(tenant_id, id),
  FOREIGN KEY(tenant_id, campus_id) REFERENCES campuses(tenant_id, id)
);
CREATE INDEX memberships_user_id_idx ON memberships(user_id);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL,
  resource_id uuid,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_tenant_time_idx ON audit_events(tenant_id, created_at DESC);

CREATE FUNCTION app.actor_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;
CREATE FUNCTION app.tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;
-- Owner-executed lookup avoids recursive membership RLS. No dynamic SQL.
CREATE FUNCTION app.has_permission(target uuid, permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT target = app.tenant_id() AND EXISTS (
   SELECT 1 FROM public.memberships m WHERE m.tenant_id = target AND m.user_id = app.actor_id()
   AND CASE permission
     WHEN 'read' THEN true
     WHEN 'campus:write' THEN m.role IN ('owner','admin')
     WHEN 'membership:write' THEN m.role IN ('owner','admin')
     WHEN 'tenant:write' THEN m.role = 'owner'
     WHEN 'audit:read' THEN m.role IN ('owner','admin')
     ELSE false END
 )
$$;
-- Discovery is restricted to the authenticated actor, not an arbitrary user argument.
CREATE FUNCTION app.my_tenants() RETURNS TABLE(id uuid, name text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT t.id, t.name, m.role FROM public.tenants t JOIN public.memberships m ON m.tenant_id=t.id
 WHERE m.user_id=app.actor_id()
$$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE campuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE campuses FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON tenants FOR SELECT USING (app.has_permission(id, 'read'));
CREATE POLICY tenant_update ON tenants FOR UPDATE USING (app.has_permission(id, 'tenant:write')) WITH CHECK (app.has_permission(id, 'tenant:write'));
CREATE POLICY campus_read ON campuses FOR SELECT USING (app.has_permission(tenant_id, 'read'));
CREATE POLICY campus_insert ON campuses FOR INSERT WITH CHECK (app.has_permission(tenant_id, 'campus:write'));
CREATE POLICY campus_update ON campuses FOR UPDATE USING (app.has_permission(tenant_id, 'campus:write')) WITH CHECK (app.has_permission(tenant_id, 'campus:write'));
CREATE POLICY member_read ON memberships FOR SELECT USING (app.has_permission(tenant_id, 'read'));
CREATE POLICY member_insert ON memberships FOR INSERT WITH CHECK (app.has_permission(tenant_id, 'membership:write') AND role IN ('staff','viewer','admin') AND (role <> 'admin' OR app.has_permission(tenant_id, 'tenant:write')));
CREATE POLICY member_update ON memberships FOR UPDATE USING (app.has_permission(tenant_id, 'membership:write') AND role <> 'owner' AND (role <> 'admin' OR app.has_permission(tenant_id, 'tenant:write'))) WITH CHECK (app.has_permission(tenant_id, 'membership:write') AND role IN ('staff','viewer','admin') AND (role <> 'admin' OR app.has_permission(tenant_id, 'tenant:write')));
CREATE POLICY member_delete ON memberships FOR DELETE USING (app.has_permission(tenant_id, 'membership:write') AND role <> 'owner' AND (role <> 'admin' OR app.has_permission(tenant_id, 'tenant:write')));
CREATE POLICY audit_read ON audit_events FOR SELECT USING (app.has_permission(tenant_id, 'audit:read'));
CREATE POLICY audit_insert ON audit_events FOR INSERT WITH CHECK (app.has_permission(tenant_id, 'read') AND actor_id = app.actor_id());

-- Only this function can create tenants and their initial owner. Preset v1 is immutable.
CREATE FUNCTION app.provision_school(tenant_name text, tenant_slug text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE new_id uuid;
BEGIN
 IF app.actor_id() IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=app.actor_id()) THEN
   RAISE EXCEPTION 'Authenticated actor required' USING ERRCODE='42501';
 END IF;
 IF length(tenant_name) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Invalid name' USING ERRCODE='22023'; END IF;
 INSERT INTO public.tenants(name,slug,preset_key,preset_version,settings)
 VALUES(tenant_name,tenant_slug,'school',1,'{"academicModel":"school","terminology":{"cohort":"grade","group":"section"},"modules":["identity","campuses","memberships"],"timezone":"Asia/Dhaka"}') RETURNING id INTO new_id;
 INSERT INTO public.campuses(tenant_id,name,code) VALUES(new_id,'Main Campus','MAIN');
 INSERT INTO public.memberships(tenant_id,user_id,role) VALUES(new_id,app.actor_id(),'owner');
 INSERT INTO public.audit_events(tenant_id,actor_id,action,resource_id,request_id)
 VALUES(new_id,app.actor_id(),'tenant.provisioned',new_id,coalesce(nullif(current_setting('app.request_id',true),''),'system'));
 RETURN new_id;
END
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO edu_runtime;
GRANT SELECT, INSERT ON users TO edu_runtime;
GRANT UPDATE(display_name) ON users TO edu_runtime;
GRANT SELECT, INSERT ON sessions TO edu_runtime;
GRANT UPDATE(revoked_at) ON sessions TO edu_runtime;
GRANT SELECT ON tenants, campuses, memberships, audit_events TO edu_runtime;
GRANT UPDATE(name) ON tenants TO edu_runtime;
GRANT INSERT ON campuses, memberships, audit_events TO edu_runtime;
GRANT UPDATE(name, code) ON campuses TO edu_runtime;
GRANT UPDATE(role, campus_id), DELETE ON memberships TO edu_runtime;
