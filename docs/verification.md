# Verification record

Work was performed in the initially empty `F:\Multi-Tenant School Management\Backend` workspace on 2026-11-14 and finally verified on 2026-11-15 (Asia/Dhaka). No Git repository existed. Tooling: Node v22.22.3, pnpm 10.11.0 via Corepack, Docker Desktop/Linux engine, PostgreSQL 17.5 container. All credentials and tenants used here are synthetic.

## Commands and results

| Exact command                                               | Result                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `corepack.cmd pnpm install`                                 | Passed; generated pnpm lockfile                                                      |
| `docker compose up -d --wait db`                            | Passed; PostgreSQL healthy                                                           |
| `Copy-Item .env.example .env`                               | Created ignored local environment file                                               |
| `corepack.cmd pnpm db:migrate`                              | Passed; applied `0001_foundation.sql`                                                |
| `corepack.cmd pnpm db:migrate` (repeat)                     | Passed; no migrations reapplied                                                      |
| `corepack.cmd pnpm db:seed`                                 | Passed; Alpha and Beta owners/School tenants created                                 |
| `corepack.cmd pnpm db:seed` (repeat)                        | Passed; existing synthetic fixtures retained                                         |
| `docker compose config --quiet`                             | Passed                                                                               |
| `corepack.cmd pnpm add @fastify/static@10.1.2 --offline`    | Passed; repaired package links after a Windows EBUSY failure                         |
| `corepack.cmd pnpm check` (final dependency set)            | Passed: TypeScript, ESLint, formatting, 2 unit tests, and production compilation     |
| `corepack.cmd pnpm openapi` (final dependency set)          | Passed; exported `openapi.json` without a database connection                        |
| `corepack.cmd pnpm test:integration` (final dependency set) | Passed: 13/13 tests against real PostgreSQL in 23.53 seconds                         |
| `docker compose build api` (final dependency set)           | Passed from the frozen lockfile                                                      |
| `docker compose --profile api up -d --wait api`             | Passed; PostgreSQL and API containers healthy                                        |
| `node scripts/smoke.mjs`                                    | Passed: health, Swagger, OpenAPI, both tenant reads, cross-tenant denial, and logout |

An earlier verification attempt was blocked when C: had only 5,058,560 bytes free and Docker's metadata filesystem became read-only. After disk recovery and a Docker restart, every affected check was rerun successfully. No unrelated files or volumes were deleted.

## Initial failures and fixes

- The workspace had no pnpm shim, and PowerShell execution policy blocked `npm.ps1`; used `corepack.cmd pnpm`.
- Docker initially had no running engine. Started Docker Desktop with approval and then successfully started PostgreSQL.
- `tsx` failed under the restricted Windows sandbox (`uv_os_get_passwd`); reran checks with approved elevated execution.
- Initial OpenAPI/integration startup failed because tsx does not emit decorator design metadata. Added explicit DTO schema types, explicit dependency injection and explicit validation types.
- Initial `pnpm check` invoked a missing nested pnpm shim. Changed the check script to call its local tools directly.
- Next OpenAPI/integration startup identified the missing `@fastify/static` Swagger UI dependency. Added the plugin and aligned it to Nest's declared peer version.
- A Windows EBUSY package-directory rename interrupted dependency alignment and temporarily broke package links. Retrying the exact version from the local pnpm cache succeeded; the subsequent full static/unit/build check passed.

## Blocked or unrun

- GitHub-hosted Actions execution: unrun. There is no Git repository/remote or hosted runner attached to this workspace. The workflow is provided; its constituent checks are run locally.
- A second physical clean-checkout machine: unrun. The Docker build validates a clean dependency install and compiled API image; README provides checkout reproduction steps.
- Browser interaction with Swagger's Try it out: unrun. HTTP smoke verification checks that docs and OpenAPI are served; integration tests exercise the API contract directly.

No claims are made about future business modules, production load, backup recovery, or external deployment.

## Phase 2 verification — 2026-11-15

The Phase 2 change added migrations `0002` through `0007`, academic configuration APIs, 18 starting categories, historical snapshots, current institution type metadata and 17 new PostgreSQL integration tests. An initial run exposed preset ordering failures, which were fixed in additive migration `0003`; later migrations added relationship checks, categories and history. All final checks below were rerun after those fixes.

| Exact command                                   | Final result                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `corepack.cmd pnpm db:migrate`                  | Passed; additive migrations through `0007_institution_type.sql` applied                    |
| `corepack.cmd pnpm check`                       | Passed; TypeScript, ESLint, formatting, 2 unit tests, production compilation               |
| `corepack.cmd pnpm test:integration`            | Passed; 30/30 real PostgreSQL tests (17 academic, 13 Phase 1 regressions)                  |
| `corepack.cmd pnpm openapi`                     | Passed; current OpenAPI contract exported                                                  |
| `docker compose build api`                      | Passed; final API image built from frozen lockfile                                         |
| `docker compose --profile api up -d --wait api` | Passed; API and PostgreSQL healthy                                                         |
| `node scripts/smoke.mjs`                        | Passed; health, Swagger/OpenAPI, academic reads, both tenants, cross-tenant denial, logout |

GitHub-hosted Actions and browser interaction remain unrun for the reasons above. Their constituent backend checks passed locally.
