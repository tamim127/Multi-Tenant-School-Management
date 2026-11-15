import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createApp } from '../src/app';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
let application: Awaited<ReturnType<typeof createApp>>;
const suffix = randomUUID().slice(0, 8);
let token: string,
  outsiderToken: string,
  viewerToken: string,
  tenant: string,
  outsiderTenant: string,
  owner: string;
async function api(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  bearer?: string,
  payload?: object,
) {
  const response = await application.app.inject({
    method,
    url,
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    payload,
  });
  return { status: response.statusCode, body: response.body ? response.json() : undefined };
}
async function identity(label: string) {
  const email = `academic-${label}-${suffix}@example.test`;
  const created = await api('POST', '/v1/auth/register', undefined, {
    email,
    password: 'Academic-Test-2026!',
    displayName: label,
  });
  expect(created.status).toBe(201);
  const login = await api('POST', '/v1/auth/login', undefined, {
    email,
    password: 'Academic-Test-2026!',
  });
  return { id: created.body.id as string, token: login.body.accessToken as string };
}
async function makeTenant(bearer: string, label: string) {
  const result = await api('POST', '/v1/tenants', bearer, {
    name: label,
    slug: `${label.toLowerCase().replaceAll(' ', '-')}-${suffix}`,
    preset: 'school@1',
  });
  expect(result.status).toBe(201);
  return result.body.id as string;
}
const path = (id: string, resource = '') =>
  `/v1/tenants/${id}/academic${resource ? `/${resource}` : ''}`;
async function add(resource: string, data: object, id = tenant, bearer = token) {
  return api('POST', path(id, resource), bearer, { data });
}
async function list(resource: string, id = tenant, bearer = token) {
  const r = await api('GET', path(id, resource), bearer);
  expect(r.status).toBe(200);
  return r.body.items as Array<Record<string, unknown>>;
}
async function preset(key: string, id = tenant, bearer = token) {
  return api('POST', path(id, 'apply-preset'), bearer, { key, version: 1 });
}
beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  process.env.DB_POOL_MAX = '1';
  application = await createApp();
  const first = await identity('owner');
  owner = first.id;
  token = first.token;
  const second = await identity('outsider');
  outsiderToken = second.token;
  const viewer = await identity('viewer');
  viewerToken = viewer.token;
  tenant = await makeTenant(token, 'Academic One');
  outsiderTenant = await makeTenant(outsiderToken, 'Academic Two');
  expect(
    (
      await api('POST', `/v1/tenants/${tenant}/memberships`, token, {
        userId: viewer.id,
        role: 'viewer',
      })
    ).status,
  ).toBe(201);
}, 60000);
afterAll(async () => {
  await application?.app.close();
  await pool.end();
});

describe('Phase 2 academic configuration with real PostgreSQL', () => {
  it('catalogues all requested starting institution categories', async () => {
    const response = await api('GET', path(tenant, 'presets'), token);
    expect(response.status).toBe(200);
    const categories = new Set(
      response.body.items.map((item: { category: string }) => item.category),
    );
    for (const category of [
      'Kindergarten',
      'Nursery School',
      'Primary School',
      'Junior School',
      'High School',
      'Secondary School',
      'Higher Secondary School',
      'School and College',
      'Higher Secondary College',
      'Degree College',
      'Honours College',
      'Postgraduate College',
      'University',
      'Alia Madrasa',
      'Qawmi Madrasa',
      'Hifz Madrasa',
      'Nurani Madrasa',
      'Combined Educational Institution',
    ])
      expect(categories.has(category)).toBe(true);
  });
  it('1 Kindergarten only', async () => {
    expect((await preset('kindergarten')).body.applied).toBe(true);
    expect((await list('levels')).map((x) => x.name)).toEqual(['Play', 'Nursery', 'KG']);
  });
  it('2 Primary Class 1–5', async () => {
    const id = await makeTenant(token, 'Primary');
    expect((await preset('primary', id)).status).toBe(201);
    expect((await list('levels', id)).map((x) => x.name)).toEqual([
      'Class 1',
      'Class 2',
      'Class 3',
      'Class 4',
      'Class 5',
    ]);
  });
  it('3 Secondary Class 6–10', async () => {
    const id = await makeTenant(token, 'Secondary');
    await preset('secondary', id);
    expect((await list('levels', id)).map((x) => x.name)).toEqual([
      'Class 6',
      'Class 7',
      'Class 8',
      'Class 9',
      'Class 10',
    ]);
  });
  it('4 Combined school Class 1–12', async () => {
    const id = await makeTenant(token, 'Combined');
    await preset('school-college', id);
    expect(await list('units', id)).toHaveLength(2);
    expect(await list('levels', id)).toHaveLength(12);
  });
  it('5 College Class 11–12', async () => {
    const id = await makeTenant(token, 'HSC');
    await preset('hsc', id);
    expect((await list('levels', id)).map((x) => x.name)).toEqual(['Class 11', 'Class 12']);
  });
  it('6 College HSC Degree Honours Masters', async () => {
    const id = await makeTenant(token, 'Full College');
    await preset('hsc-honours-masters', id);
    expect((await list('units', id)).map((x) => x.code).sort()).toEqual([
      'degree',
      'honours',
      'hsc',
      'masters',
    ]);
  });
  it('7 University undergraduate and postgraduate', async () => {
    const id = await makeTenant(token, 'University');
    await preset('university', id);
    expect((await api('GET', `/v1/tenants/${id}`, token)).body.institutionType).toBe('university');
    expect((await list('programs', id)).map((x) => x.progression_model)).toEqual([
      'credit',
      'credit',
    ]);
  });
  it('8 Madrasa custom Jamat and Marhala', async () => {
    const id = await makeTenant(token, 'Madrasa');
    await preset('qawmi-madrasa', id);
    expect((await list('levels', id)).map((x) => x.name)).toEqual(['Jamat', 'Marhala']);
  });
  it('9 Multiple academic units in one tenant', async () => {
    expect((await add('units', { code: 'hifz', name: 'Hifz', unit_type: 'hifz' })).status).toBe(
      201,
    );
    expect((await list('units')).length).toBeGreaterThan(1);
  });
  it('10 Custom categories, programs and levels', async () => {
    expect(
      (
        await add('categories', {
          code: 'custom-mixed',
          name: 'Custom Mixed',
          institution_type: 'combined',
        })
      ).status,
    ).toBe(201);
    const program = await add('programs', {
      code: 'custom',
      name: 'Custom',
      progression_model: 'competency',
    });
    expect(program.status).toBe(201);
    expect(
      (await add('levels', { program_id: program.body.id, code: 'marhala-x', name: 'Marhala X' }))
        .status,
    ).toBe(201);
  });
  it('11 Hierarchy cycles and cross-tenant foreign keys are denied', async () => {
    const parent = await add('units', { code: 'parent', name: 'Parent', unit_type: 'custom' });
    const child = await add('units', {
      code: 'child',
      name: 'Child',
      unit_type: 'custom',
      parent_id: parent.body.id,
    });
    expect(child.status).toBe(201);
    expect(
      (
        await api('PATCH', path(tenant, `units/${parent.body.id}`), token, {
          data: { parent_id: child.body.id },
        })
      ).status,
    ).toBe(400);
    const other = await add(
      'units',
      { code: 'other', name: 'Other', unit_type: 'custom' },
      outsiderTenant,
      outsiderToken,
    );
    expect(
      (
        await add('units', {
          code: 'invalid',
          name: 'Invalid',
          unit_type: 'custom',
          parent_id: other.body.id,
        })
      ).status,
    ).toBe(400);
    const first = await add('programs', {
      code: 'integrity-one',
      name: 'One',
      progression_model: 'class',
    });
    const second = await add('programs', {
      code: 'integrity-two',
      name: 'Two',
      progression_model: 'credit',
    });
    const unit = await add('units', {
      code: 'integrity-unit',
      name: 'Unit',
      unit_type: 'custom',
      program_id: first.body.id,
    });
    const level = await add('levels', {
      code: 'integrity-level',
      name: 'Level',
      program_id: second.body.id,
    });
    expect(
      (await add('assignments', { unit_id: unit.body.id, level_id: level.body.id })).status,
    ).toBe(400);
    const period = await add('periods', {
      level_id: level.body.id,
      code: 'semester-1',
      name: 'Semester 1',
      period_type: 'semester',
    });
    expect(
      (
        await add('subjects', {
          program_id: first.body.id,
          period_id: period.body.id,
          code: 'course-x',
          name: 'Course X',
          subject_type: 'course',
        })
      ).status,
    ).toBe(400);
  });
  it('12 Template application is idempotent and preserves edits', async () => {
    const before = (await list('levels')).length;
    expect((await preset('kindergarten')).body.applied).toBe(false);
    expect((await list('levels')).length).toBe(before);
    const kg = (await list('units')).find((x) => x.code === 'kindergarten')!;
    expect(
      (await api('PATCH', path(tenant, `units/${kg.id}`), token, { data: { name: 'My KG' } }))
        .status,
    ).toBe(200);
    expect((await preset('kindergarten')).body.applied).toBe(false);
    expect((await list('units')).find((x) => x.code === 'kindergarten')?.name).toBe('My KG');
  });
  it('13 RLS isolates academic reads and writes', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id',$2,true)",
        [owner, tenant],
      );
      expect(
        (await client.query('SELECT * FROM academic_units WHERE tenant_id=$1', [outsiderTenant]))
          .rowCount,
      ).toBe(0);
      await expect(
        client.query(
          "INSERT INTO academic_units(tenant_id,code,name,unit_type) VALUES($1,'forged','Forged','custom')",
          [outsiderTenant],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect((await api('GET', path(outsiderTenant, 'units'), token)).status).toBe(403);
  });
  it('14 Viewer cannot configure academic resources', async () => {
    expect(
      (
        await add(
          'units',
          { code: 'denied', name: 'Denied', unit_type: 'custom' },
          tenant,
          viewerToken,
        )
      ).status,
    ).toBe(403);
    expect((await preset('primary', tenant, viewerToken)).status).toBe(403);
  });
  it('15 Archive preserves historical IDs and records', async () => {
    const created = await add('units', { code: 'history', name: 'History', unit_type: 'custom' });
    expect(
      (await api('POST', path(tenant, `units/${created.body.id}/archive`), token)).status,
    ).toBe(200);
    expect((await list('units')).some((x) => x.id === created.body.id)).toBe(true);
    const history = await api('GET', path(tenant, `units/${created.body.id}/history`), token);
    expect(history.status).toBe(200);
    expect(
      history.body.items.some(
        (x: { prior_row: { name: string } }) => x.prior_row.name === 'History',
      ),
    ).toBe(true);
    expect(
      (await api('GET', path(tenant, 'active'), token)).body.units.some(
        (x: { id: string }) => x.id === created.body.id,
      ),
    ).toBe(false);
  });
  it('16 Phase 1 tenant, campus, sessions and membership contract persists', async () => {
    expect((await api('GET', `/v1/tenants/${tenant}`, token)).status).toBe(200);
    expect((await api('GET', `/v1/tenants/${tenant}/campuses`, token)).status).toBe(200);
    expect((await api('GET', `/v1/tenants/${tenant}/memberships`, token)).status).toBe(200);
    expect((await api('GET', '/v1/auth/sessions', token)).status).toBe(200);
  });
});
