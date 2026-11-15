# Architecture and phase scope

## Phase 0: foundation

This repository is a backend-only modular monolith: NestJS over Fastify, strict TypeScript, pnpm, PostgreSQL, and Drizzle using the `pg` pool. Versioned SQL is the database source of truth. Drizzle defines typed queries; it does not generate or push the production schema. Docker Compose supplies PostgreSQL, and GitHub Actions runs checks against real PostgreSQL.

The API boundary validates DTOs, authenticates opaque sessions, resolves membership, runs a transaction, and emits a safe response. SQL is parameterized. No frontend or academic operations are implemented.

## Phase 1: identity and tenancy

Global identity comprises users and sessions. A user can join multiple tenants with different roles. Users cannot discover all global users over HTTP: `/users/me` returns self and tenant user lists join through RLS-filtered memberships. Membership creation requires the existing user's UUID; invitation and email verification flows are later work.

Tenant-owned records are tenants, campuses, memberships, and audit events. Campuses and memberships have `(tenant_id, id)` unique keys. The membership campus reference uses `(tenant_id, campus_id)` so a valid campus UUID from another tenant still fails. Global user references intentionally do not have tenant IDs. Campus assignment is descriptive in Phase 1; permissions apply to the whole tenant, not an individual campus.

### Request and connection lifecycle

1. Hash the Bearer token and look up an unrevoked, unexpired session. The session provides the actor UUID.
2. Treat the path's tenant UUID only as a requested scope. Ignore tenant identity headers and reject extra body fields.
3. Acquire a connection via a Drizzle transaction. Set `app.user_id`, `app.tenant_id`, and `app.request_id` with `set_config(..., true)`.
4. Check current membership with `app.has_permission`. Nonmembers receive 403 before resource queries.
5. Execute queries and mutation audit inserts in the same transaction. RLS repeats membership and role checks at the database boundary.
6. Commit or roll back. Local settings disappear before the connection returns to the pool. Never use session-level `SET`, a shared mutable tenant variable, or the global pool for tenant queries.

The integration suite fixes a PostgreSQL pool to one connection, verifies its backend PID across alternating tenants, and proves context is cleared after both commit and rollback. It also exercises the application's transaction helper. Revocations take effect on subsequent requests; already-running requests can finish using their established identity. Membership policies are evaluated per statement under READ COMMITTED.

### Database trust boundary

`edu_runtime` is a LOGIN role without SUPERUSER, BYPASSRLS, CREATEDB, CREATEROLE, table ownership, or membership in the migration role. Grants restrict columns and prevent tenant identity changes, direct tenant insertion, audit modification/deletion, schema creation, and owner role changes. Tenant tables enable and force RLS.

The migration connection is a separate privileged administrative credential. Local Compose uses its PostgreSQL bootstrap superuser as migration/function owner. The narrowly scoped SECURITY DEFINER functions require an owner able to bypass forced RLS; in production use an isolated NOLOGIN BYPASSRLS function owner, grant it only necessary tables, and transfer the functions with reviewed infrastructure migrations. Never give runtime membership in that role. Function search paths are fixed, table references are qualified, and PUBLIC execute is revoked. PUBLIC schema CREATE is revoked at bootstrap.

Custom PostgreSQL context settings are trusted application assertions, not cryptographically authenticated identities. A holder of the runtime credential or arbitrary SQL execution in the process can impersonate an actor by changing settings, and can access global identity tables. RLS protects against missing tenant predicates and application authorization mistakes, not a compromised application or leaked database credentials. Runtime credentials never reach clients. Global identity operations are a deliberately trusted service boundary; separate identity service credentials can be introduced later.

### Provisioning and presets

An authenticated user calls `POST /v1/tenants` with `preset: school@1`. A restricted function atomically creates the tenant, immutable preset snapshot/version, Main Campus, owner membership, and provisioning audit event. Unique slug conflicts roll back everything. Only the function can create an owner. Runtime cannot alter preset configuration. Future preset versions require new SQL migrations and explicit migration plans; existing tenants do not silently change defaults.

School v1 supplies terminology and a timezone default only. It does not create academic tables, fees, exams, or student records. Owner transfer, tenant deletion, campus deletion, and password recovery are deliberately absent from this foundation.

### Sessions and operations

Passwords use salted asynchronous Node scrypt; plaintext credentials never persist. Random 256-bit opaque tokens are returned once; only SHA-256 token hashes persist. Absolute lifetime defaults to eight hours. Users can list and revoke their sessions or log out. There are no refresh tokens or public API keys. HTTP requests are rate-limited per IP in a single process (120/minute); production multi-instance deployments need a shared rate-limit store and reviewed proxy trust configuration. TLS termination, external secrets, backups, restoration drills, email verification, password recovery, retention and monitoring are deployment follow-up work.

Audit events store actor, tenant, action, resource UUID, generated request ID, and timestamp, never passwords or tokens. Tenant mutations through the API are audited atomically. Events are append-only for runtime, but are not cryptographically tamper-evident against database administrators. Authentication/profile events are outside the tenant audit stream in this phase. Failed transactions leave no success audit; external security telemetry is later work.

## Future module boundaries (not implemented)

| Phase | Module               | Ownership and boundary                                                                                      |
| ----- | -------------------- | ----------------------------------------------------------------------------------------------------------- |
| Later | Academic operations  | Enrollment, promotion, credits and Hifz tracking build on Phase 2 configuration; preserve tenant-safe keys  |
| 3     | Fees and billing     | Own invoices, charges, payments, reconciliation and immutable ledger; consumes enrollment references        |
| 3     | Payroll              | Own contracts, pay runs, deductions and payout ledger; consumes staff references, never shares fee balances |
| 4     | Exams and assessment | Own assessment definitions, grading, results and publication; integrates through academic identifiers       |
| 5     | Realtime/WebSockets  | Authenticated, membership-verified subscriptions; revocation and reconnect semantics required               |
| 5     | Devices              | Dedicated ingestion, device credentials, replay protection, validation and idempotency                      |
| 5     | Public API keys      | Separate machine identities, scopes, hashed secrets, rotation, revocation and rate limits                   |

No tables, routes, background jobs, dependencies, or stubs implement these future business modules.
