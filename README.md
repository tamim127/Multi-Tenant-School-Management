# Education SaaS backend — Phase 0 and Phase 1

Backend only: NestJS/Fastify, TypeScript, pnpm, PostgreSQL, Drizzle/pg, versioned SQL, OpenAPI and CI. Includes authentication, revocable sessions, users, School v1 tenant provisioning, campuses, memberships, tenant permissions, append-only audit events and health checks. No frontend or later-phase business modules.

Read [architecture](docs/architecture.md), [academic models](docs/academic-models.md), [permissions](docs/permissions.md), and [API conventions](docs/api.md).

## Clean checkout

Prerequisites: Node 22, Corepack or pnpm 10.11.0, Docker with a running Linux container engine. Local ports 5432 and 3000 must be available. Compose passwords are synthetic development credentials.

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d --wait db
pnpm db:migrate
pnpm db:seed
pnpm check
pnpm test:integration
pnpm openapi
pnpm build
pnpm start
```

PowerShell: use `Copy-Item .env.example .env` in place of `cp`; if script execution policy blocks shims, use `corepack.cmd pnpm` instead of `pnpm`. Scripts load `.env` automatically. Only migrations use `MIGRATION_DATABASE_URL`; application and seed use the restricted `DATABASE_URL`. Do not supply migration credentials to the running API. Migrations are ordered SQL files with checksums, transactional application and an advisory lock; reruns are safe, edited applied migrations fail. Role bootstrap runs only for a new Docker volume.

Open <http://localhost:3000/docs> or fetch <http://localhost:3000/openapi.json>. Liveness is <http://localhost:3000/v1/health/live>; readiness is <http://localhost:3000/v1/health/ready>. Optional containerized API after migration: `docker compose --profile api up -d --build api`.

## Reproduce two-tenant verification

`pnpm db:seed` idempotently creates **Synthetic Alpha School** and **Synthetic Beta School**, each with an owner and Main Campus. Owner emails: `owner.alpha@example.test` and `owner.beta@example.test`; both use `Synthetic-Only-2026!`. Seed refuses `NODE_ENV=production`.

```sh
pnpm db:migrate
pnpm db:migrate
pnpm db:seed
pnpm db:seed
pnpm test:integration
```

Tests create separately named synthetic Alpha/Beta tenants and owner/admin/staff/viewer accounts on each run. They use real SQL through the runtime role and HTTP through Fastify injection; there is no mocked database or requirement for an already-running API. Test fixtures remain for inspection. Use a disposable database. The suite proves allowed and denied reads/writes, composite foreign keys, role restrictions, audit restrictions and same-connection context cleanup. Run tests repeatedly to check pool reuse; random fixture suffixes avoid conflicts.

For manual API QA in PowerShell:

```powershell
$login = Invoke-RestMethod -Method Post -Uri http://localhost:3000/v1/auth/login -ContentType application/json -Body '{"email":"owner.alpha@example.test","password":"Synthetic-Only-2026!"}'
$headers = @{ Authorization = "Bearer $($login.accessToken)" }
$tenants = Invoke-RestMethod -Uri http://localhost:3000/v1/tenants -Headers $headers
$tenantId = $tenants.items[0].id
Invoke-RestMethod -Uri "http://localhost:3000/v1/tenants/$tenantId/campuses" -Headers $headers
```

Repeat login/discovery for Beta, then request Beta's campus URL with Alpha's headers: expect 403. Swagger offers the same requests with its Authorize button. See [API QA](docs/api.md) for viewer and revoked-session checks.

With the seeded API running, `node scripts/smoke.mjs` automates this live HTTP check, including health, Swagger/OpenAPI and logout. It uses only the synthetic seed credentials and revokes the sessions it creates. Set `QA_BASE_URL` to target a different local port.

`docker compose down` preserves local data. To deliberately erase **only this Compose project's disposable data**, use `docker compose down -v`, then repeat setup. This is destructive; never do it against a persistent deployment.

## Checks

`pnpm check` runs typecheck, ESLint, formatting, unit tests and compilation. `pnpm test:integration` requires a migrated PostgreSQL database and fails if it is unavailable. `pnpm openapi` exports the contract without a database. CI repeats migration and seed to verify reruns and builds the API container. Local execution evidence is recorded in [verification](docs/verification.md).
