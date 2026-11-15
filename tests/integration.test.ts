import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { createApp } from '../src/app';
import { Database } from '../src/database';
import { tokenHash } from '../src/password';
import { sql } from 'drizzle-orm';

// Run against a disposable migrated PostgreSQL database. No mocks, no owner queries.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
let application: Awaited<ReturnType<typeof createApp>>;
let ownerA: string, ownerB: string, viewer: string, admin: string, staff: string;
let tokenA: string,
  tokenB: string,
  viewerToken: string,
  tenantA: string,
  tenantB: string,
  campusB: string;
const suffix = randomUUID().slice(0, 8);
const password = 'Integration-Only-2026!';
async function api(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  token?: string,
  payload?: object,
) {
  const result = await application.app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload,
  });
  return { status: result.statusCode, body: result.body ? result.json() : undefined };
}
async function account(name: string) {
  const email = `${name}.${suffix}@example.test`;
  const registered = await api('POST', '/v1/auth/register', undefined, {
    email,
    password,
    displayName: name,
  });
  expect(registered.status).toBe(201);
  expect(registered.body.passwordHash).toBeUndefined();
  const login = await api('POST', '/v1/auth/login', undefined, { email, password });
  expect(login.status).toBe(200);
  return { id: registered.body.id as string, token: login.body.accessToken as string };
}
async function context<T>(actor: string, tenant: string, fn: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id',$2,true)",
      [actor, tenant],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
beforeAll(async () => {
  process.env.DB_POOL_MAX = '1';
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required: run migrations first');
  application = await createApp();
  const a = await account('owner-a');
  ownerA = a.id;
  tokenA = a.token;
  const b = await account('owner-b');
  ownerB = b.id;
  tokenB = b.token;
  const v = await account('viewer');
  viewer = v.id;
  viewerToken = v.token;
  admin = (await account('admin')).id;
  staff = (await account('staff')).id;
  const aTenant = await api('POST', '/v1/tenants', tokenA, {
    name: 'Test Alpha',
    slug: `alpha-${suffix}`,
    preset: 'school@1',
  });
  expect(aTenant.status).toBe(201);
  tenantA = aTenant.body.id;
  const bTenant = await api('POST', '/v1/tenants', tokenB, {
    name: 'Test Beta',
    slug: `beta-${suffix}`,
    preset: 'school@1',
  });
  expect(bTenant.status).toBe(201);
  tenantB = bTenant.body.id;
  campusB = (await api('GET', `/v1/tenants/${tenantB}/campuses`, tokenB)).body.items[0].id;
  for (const [userId, role] of [
    [viewer, 'viewer'],
    [admin, 'admin'],
    [staff, 'staff'],
  ]) {
    expect(
      (await api('POST', `/v1/tenants/${tenantA}/memberships`, tokenA, { userId, role })).status,
    ).toBe(201);
  }
}, 60000);
afterAll(async () => {
  await pool.end();
  await application?.app.close();
});

describe('real PostgreSQL tenant isolation', () => {
  it('uses a restricted role; rejects DDL, role escalation, direct provisioning and audit tampering', async () => {
    const role = (
      await pool.query(
        'SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user',
      )
    ).rows[0];
    expect(Object.values(role)).toEqual([false, false, false, false]);
    for (const statement of [
      'CREATE TABLE public.forbidden(id int)',
      'ALTER ROLE edu_runtime BYPASSRLS',
      'SET ROLE edu_owner',
      "INSERT INTO tenants(name,slug,preset_key,preset_version,settings) VALUES('bad','bad-school','school',1,'{}')",
      'DELETE FROM audit_events',
      "UPDATE audit_events SET action='changed'",
    ]) {
      await expect(pool.query(statement)).rejects.toMatchObject({ code: '42501' });
    }
  });
  it('fails closed without context and allows only own reads', async () => {
    expect((await pool.query('SELECT * FROM campuses')).rowCount).toBe(0);
    const rows = await context(
      ownerA,
      tenantA,
      async (c) => (await c.query('SELECT * FROM campuses')).rows,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenant_id === tenantA)).toBe(true);
    expect(
      await context(
        ownerA,
        tenantB,
        async (c) => (await c.query('SELECT * FROM campuses')).rowCount,
      ),
    ).toBe(0);
    expect(
      await context(
        ownerB,
        tenantB,
        async (c) => (await c.query('SELECT * FROM campuses')).rowCount,
      ),
    ).toBe(1);
  });
  it('allows owner writes, denies cross-tenant inserts and hides cross-tenant updates', async () => {
    await context(ownerA, tenantA, (c) =>
      c.query('INSERT INTO campuses(tenant_id,name,code) VALUES($1,$2,$3)', [
        tenantA,
        'Allowed',
        'ALLOWED',
      ]),
    );
    await expect(
      context(ownerA, tenantA, (c) =>
        c.query('INSERT INTO campuses(tenant_id,name,code) VALUES($1,$2,$3)', [
          tenantB,
          'Denied',
          'DENIED',
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    expect(
      await context(
        ownerA,
        tenantA,
        async (c) =>
          (await c.query('UPDATE campuses SET name=$1 WHERE id=$2', ['bad', campusB])).rowCount,
      ),
    ).toBe(0);
  });
  it('rejects cross-tenant foreign keys even when both identifiers exist', async () => {
    await expect(
      context(ownerA, tenantA, (c) =>
        c.query('UPDATE memberships SET campus_id=$1 WHERE tenant_id=$2 AND user_id=$3', [
          campusB,
          tenantA,
          viewer,
        ]),
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });
  it('enforces viewer/staff writes and admin role restrictions in PostgreSQL', async () => {
    for (const actor of [viewer, staff]) {
      await expect(
        context(actor, tenantA, (c) =>
          c.query("INSERT INTO campuses(tenant_id,name,code) VALUES($1,'Denied','DENIED')", [
            tenantA,
          ]),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    }
    await context(admin, tenantA, (c) =>
      c.query("INSERT INTO campuses(tenant_id,name,code) VALUES($1,'Admin campus','ADMIN')", [
        tenantA,
      ]),
    );
    await expect(
      context(admin, tenantA, (c) =>
        c.query("UPDATE memberships SET role='admin' WHERE tenant_id=$1 AND user_id=$2", [
          tenantA,
          viewer,
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    expect(
      await context(
        admin,
        tenantA,
        async (c) =>
          (
            await c.query('DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2', [
              tenantA,
              ownerA,
            ])
          ).rowCount,
      ),
    ).toBe(0);
    await expect(
      context(ownerA, tenantA, (c) =>
        c.query("UPDATE memberships SET role='owner' WHERE tenant_id=$1 AND user_id=$2", [
          tenantA,
          viewer,
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('restricts audit reads, prevents actor forgery and commits mutation audits', async () => {
    expect(
      await context(
        viewer,
        tenantA,
        async (c) => (await c.query('SELECT * FROM audit_events')).rowCount,
      ),
    ).toBe(0);
    const events = await context(
      ownerA,
      tenantA,
      async (c) => (await c.query('SELECT * FROM audit_events')).rows,
    );
    expect(events.some((e) => e.action === 'tenant.provisioned')).toBe(true);
    expect(events.some((e) => e.action === 'membership.created')).toBe(true);
    expect(events.every((e) => e.tenant_id === tenantA)).toBe(true);
    await expect(
      context(ownerA, tenantA, (c) =>
        c.query(
          "INSERT INTO audit_events(tenant_id,actor_id,action,request_id) VALUES($1,$2,'forged','test')",
          [tenantA, ownerB],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('clears transaction context on same pooled connection after commit and rollback', async () => {
    const firstPid = (await pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    for (const [actor, tenant] of [
      [ownerA, tenantA],
      [ownerB, tenantB],
    ]) {
      await context(actor, tenant, async (c) => {
        expect((await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid).toBe(firstPid);
        expect(
          (await c.query('SELECT * FROM campuses')).rows.every((r) => r.tenant_id === tenant),
        ).toBe(true);
      });
      expect(
        (await pool.query('SELECT app.actor_id() AS actor, app.tenant_id() AS tenant')).rows[0],
      ).toEqual({ actor: null, tenant: null });
      expect((await pool.query('SELECT * FROM campuses')).rowCount).toBe(0);
    }
    await expect(context(ownerA, tenantA, (c) => c.query('SELECT 1/0'))).rejects.toMatchObject({
      code: '22012',
    });
    expect(
      (
        await pool.query(
          'SELECT app.actor_id() AS actor, app.tenant_id() AS tenant, pg_backend_pid() AS pid',
        )
      ).rows[0],
    ).toEqual({ actor: null, tenant: null, pid: firstPid });
    expect((await pool.query('SELECT * FROM campuses')).rowCount).toBe(0);
  });
  it('also clears the actual application transaction helper after failures', async () => {
    const database = application.app.get(Database);
    const pid = (await database.pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await expect(database.context(ownerA, tenantB, 'denied', async () => true)).rejects.toThrow(
      'Tenant membership required',
    );
    await expect(
      database.context(ownerA, tenantA, 'rollback', async () => {
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    await database.context(ownerB, tenantB, 'success', async (db) => {
      const result = await db.execute(
        sql`SELECT pg_backend_pid() AS pid, app.tenant_id() AS tenant`,
      );
      expect(result.rows[0]).toEqual({ pid, tenant: tenantB });
    });
    expect(
      (
        await database.pool.query(
          'SELECT pg_backend_pid() AS pid, app.actor_id() AS actor, app.tenant_id() AS tenant',
        )
      ).rows[0],
    ).toEqual({ pid, actor: null, tenant: null });
    expect((await database.pool.query('SELECT * FROM campuses')).rowCount).toBe(0);
  });
});

describe('HTTP contract and sessions', () => {
  it('rejects expired sessions and invalid credentials', async () => {
    const expiredToken = 'x'.repeat(43);
    // A distinct valid-format token has a matching hash but an expired timestamp.
    const expired = (suffix + expiredToken).slice(0, 43);
    await pool.query(
      "INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()-interval '1 second')",
      [ownerA, tokenHash(expired)],
    );
    expect((await api('GET', '/v1/users/me', expired)).status).toBe(401);
    expect(
      (
        await api('POST', '/v1/auth/login', undefined, {
          email: `owner-a.${suffix}@example.test`,
          password: 'Incorrect-Password!',
        })
      ).status,
    ).toBe(401);
  });
  it('exposes health and OpenAPI, validates input, and rejects anonymous access', async () => {
    expect((await api('GET', '/v1/health/live')).status).toBe(200);
    expect((await api('GET', '/v1/health/ready')).status).toBe(200);
    expect((await api('GET', '/openapi.json')).body.paths['/v1/tenants']).toBeDefined();
    expect((await api('GET', '/v1/tenants')).status).toBe(401);
    expect(
      (await api('POST', '/v1/tenants', tokenA, { name: 'Bad', slug: 'bad', preset: 'college@1' }))
        .status,
    ).toBe(400);
    expect(
      (
        await api('POST', '/v1/tenants', tokenA, {
          name: 'Bad',
          slug: 'bad',
          preset: 'school@1',
          tenantId: tenantB,
        })
      ).status,
    ).toBe(400);
  });
  it('resolves tenant from session and verified membership, never an arbitrary header', async () => {
    expect((await api('GET', `/v1/tenants/${tenantB}/campuses`, tokenA)).status).toBe(403);
    const result = await application.app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantA}/campuses`,
      headers: { authorization: `Bearer ${tokenA}`, 'x-tenant-id': tenantB },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().items.every((r: { tenantId: string }) => r.tenantId === tenantA)).toBe(
      true,
    );
    expect(
      (
        await api('POST', `/v1/tenants/${tenantA}/campuses`, viewerToken, {
          name: 'Denied',
          code: 'DENIED',
        })
      ).status,
    ).toBe(403);
  });
  it('returns School v1 settings and preserves atomic provisioning on duplicate slug', async () => {
    const tenant = await api('GET', `/v1/tenants/${tenantA}`, tokenA);
    expect(tenant.body.presetKey).toBe('school');
    expect(tenant.body.presetVersion).toBe(1);
    expect(tenant.body.settings.academicModel).toBe('school');
    expect(
      (
        await api('POST', '/v1/tenants', tokenA, {
          name: 'Duplicate',
          slug: `alpha-${suffix}`,
          preset: 'school@1',
        })
      ).status,
    ).toBe(409);
    expect((await api('GET', '/v1/tenants', tokenA)).body.items).toHaveLength(1);
  });
  it('does not expose password/session hashes and enforces revocation', async () => {
    const me = await api('GET', '/v1/users/me', tokenA);
    expect(me.body.passwordHash).toBeUndefined();
    const listing = await api('GET', '/v1/auth/sessions', tokenA);
    expect(listing.body.items[0].tokenHash).toBeUndefined();
    expect(
      (await api('DELETE', `/v1/auth/sessions/${listing.body.items[0].id}`, tokenB)).status,
    ).toBe(404);
    expect((await api('POST', '/v1/auth/logout', viewerToken)).status).toBe(204);
    expect((await api('GET', '/v1/users/me', viewerToken)).status).toBe(401);
  });
});
