# API conventions and local QA

Base path `/v1`; JSON only. Interactive OpenAPI QA is `/docs`, machine contract is `/openapi.json`, and `pnpm openapi` exports `openapi.json` without connecting to PostgreSQL. This is API documentation, not a product frontend.

Use `Authorization: Bearer <accessToken>` from login. Tokens are opaque, not JWTs. Tenant scope is `/v1/tenants/{tenantId}` and requires verified membership for the authenticated session. `X-Tenant-ID` is ignored. User-supplied actor IDs cannot override identity. DTOs reject unknown fields; UUID path parameters and bounded body fields are validated.

POST creates resources with 201, login returns 200, updates return 200, revoke/logout/delete return 204. Lists return `{ "items": [...] }`, deterministically ordered and capped at 100; pagination beyond that cap is deferred and clients must not assume full exports. Errors return `{ "statusCode": number, "message": string | object, "requestId": string }`; validation messages use Nest's nested error object. 400 invalid input/relationship, 401 missing/expired/revoked credentials, 403 denied tenant/write access, 404 missing or hidden update target, 409 unique conflict, 429 rate limit, 503 readiness failure. Fastify parser/rate-limit errors retain its native error format. No SQL details or secrets are returned.

| Routes                                                                             | Purpose                                                  |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `POST /v1/auth/register`, `POST /v1/auth/login`                                    | Global account and session                               |
| `GET /v1/auth/sessions`, `DELETE /v1/auth/sessions/{id}`, `POST /v1/auth/logout`   | Own session lifecycle                                    |
| `GET/PATCH /v1/users/me`                                                           | Own public profile                                       |
| `GET/POST /v1/tenants`                                                             | Membership-filtered discovery and School v1 provisioning |
| `GET/PATCH /v1/tenants/{tenantId}`                                                 | Tenant details/rename (rename uses `displayName`)        |
| `GET/POST /v1/tenants/{tenantId}/campuses`, `PATCH .../campuses/{id}`              | Campus management                                        |
| `GET/POST /v1/tenants/{tenantId}/memberships`, `PATCH/DELETE .../memberships/{id}` | Existing-user membership and role management             |
| `GET /v1/tenants/{tenantId}/users`                                                 | Tenant users without credential fields                   |
| `GET /v1/tenants/{tenantId}/permissions`                                           | Effective permission names                               |
| `GET /v1/tenants/{tenantId}/audit-events`                                          | Latest tenant mutation events                            |
| `GET /v1/health/live`, `GET /v1/health/ready`                                      | Process and database/schema availability                 |

Provisioning accepts `{ "name":"Example School", "slug":"example-school", "preset":"school@1" }`. Retrying the same slug returns 409; general idempotency keys are deferred. Timestamps are UTC ISO 8601; identifiers are UUIDs. Membership campus ID can be supplied on creation; role changes are separate and campus reassignment is deferred.

For a two-tenant manual QA check, log in as each seeded owner, record their tenant UUIDs from GET `/v1/tenants`, and authorize Swagger with the Alpha token. Alpha campus reads must return 200; Beta campus reads must return 403. Repeat with Beta. Add a fresh registered user's UUID as viewer in Alpha, log in as that user, and try creating a campus: expect 403. Log out and repeat any protected read: expect 401.

## Phase 2 academic configuration

All routes use `/v1/tenants/{tenantId}/academic` with the same Bearer session and verified membership. `GET /presets` lists versioned templates; `POST /apply-preset` accepts `{ "key":"primary", "version":1 }` and returns `{ "applied":true|false }`. `GET /active` returns active normalized entities.

The resource routes `GET/POST /{resource}`, `PATCH /{resource}/{id}`, and `POST /{resource}/{id}/archive` support `categories`, `sessions`, `programs`, `units`, `levels`, `assignments`, `terms`, `periods`, `groups`, and `subjects`. Create/update bodies use `{ "data": { ... } }` with resource-specific snake_case fields. For example, create a program with `{ "data":{"code":"primary","name":"Primary","progression_model":"class"} }`; create a level with `{ "data":{"program_id":"<uuid>","code":"class-1","name":"Class 1"} }`. Unknown resources and columns are rejected. Archived rows remain visible in resource lists for history, but disappear from `/active`.

`GET /{resource}/{id}/history` returns prior row snapshots captured before updates and archives. The runtime role cannot delete academic structures or rewrite these snapshots.
