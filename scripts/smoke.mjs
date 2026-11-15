/* global process, fetch, console */
import assert from 'node:assert/strict';

const base = process.env.QA_BASE_URL ?? 'http://localhost:3000';
async function request(path, token, body) {
  const response = await fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return response;
}
for (const path of ['/v1/health/live', '/v1/health/ready', '/docs', '/openapi.json']) {
  assert.equal((await request(path)).status, 200, path);
}
const identities = [];
for (const key of ['alpha', 'beta']) {
  const login = await request('/v1/auth/login', undefined, {
    email: `owner.${key}@example.test`,
    password: 'Synthetic-Only-2026!',
  });
  assert.equal(login.status, 200);
  const { accessToken } = await login.json();
  const discovered = await request('/v1/tenants', accessToken);
  assert.equal(discovered.status, 200);
  const { items } = await discovered.json();
  assert.equal(items.length, 1);
  identities.push({ token: accessToken, tenant: items[0].id });
}
for (const [index, identity] of identities.entries()) {
  assert.equal(
    (await request(`/v1/tenants/${identity.tenant}/campuses`, identity.token)).status,
    200,
  );
  assert.equal(
    (await request(`/v1/tenants/${identities[1 - index].tenant}/campuses`, identity.token)).status,
    403,
  );
  assert.equal((await request('/v1/auth/logout', identity.token, {})).status, 204);
  assert.equal((await request('/v1/users/me', identity.token)).status, 401);
}
console.log(
  'PASS: live API health, Swagger, OpenAPI, both tenant reads, cross-tenant denial and logout',
);
