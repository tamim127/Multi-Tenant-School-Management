# Phase 2 academic configuration architecture

Phase 1 has only tenants, campuses, memberships and audit events. No Phase 2 academic tables existed at the start of this change. The Phase 1 `school@1` provisioning endpoint and its immutable settings remain intact. Academic configuration is a separate tenant-owned context that can be applied after provisioning; institution type and category are descriptive, not a rigid class range.

The tenant's current `institution_type` starts as `school`, follows its first applied academic preset, and becomes `combined` if different institution types are applied later. This current descriptor is separate from the immutable Phase 1 `preset_key`/`preset_version` snapshot.

## Relational model

`institution_categories` (custom tenant taxonomy) and versioned global `academic_presets` describe starting configurations. Each tenant can apply a preset once. Application records its version in `tenant_preset_applications`, creates only absent structures by stable code, and never updates existing tenant rows. A later preset version is an explicit operation; custom changes remain untouched.

The configuration tables are `academic_units`, `academic_programs`, `academic_sessions`, `academic_levels`, `academic_level_assignments`, `academic_terms`, `academic_periods`, `academic_groups`, and `academic_subjects`. Each has `tenant_id`; every parent reference includes `tenant_id` in its foreign key. Units can nest, attach to a campus, program and session, and carry JSON configuration overrides. Programs carry a progression model. Levels belong to programs and may be assigned to multiple units. Periods represent class/year/term/semester without forcing one type. Groups represent section/batch/group. Subjects or courses attach to a program and optionally a period. Optional links allow institution-specific paths through the conceptual hierarchy.

Rows are archived with `archived_at`, not deleted through the API. Names and configuration can change without rewriting prior IDs. A trigger rejects cycles in unit parentage, including cycles introduced by updates. Composite foreign keys reject cross-tenant relationships, and PostgreSQL RLS enforces verified membership plus `academic:write` for mutations. Owner/admin may configure; staff/viewer may read. Physical deletion is not granted to the runtime role. The permission model remains tenant-wide; campus association is structure metadata, not a campus access grant.

Presets cover the requested school, college, university and madrasa categories, but are editable starting points. Custom categories, unit types, level labels and codes are data. No fixed class range or academic outcome logic appears in code. The API supports custom units, levels, periods, groups, programs, subjects/courses, sessions, terms, archival and an active-structure view. Actual enrollment, promotion, credits, assessments and Hifz tracking are later contexts.

## Compatibility and migration

Migration `0002_academic_configuration.sql` only adds tables/functions and extends the Phase 1 permission function. Existing tenants can apply a preset or create structures directly. `school@1` remains the default provisioning contract; additional institution types are configured through this context without changing tenant identity or rewriting Phase 1 data. The original `preset_key` check remains to avoid changing an established API or historical tenant snapshot. A future explicit provisioning API can expose other starting presets after the configuration model is proven.

The HTTP API is under `/v1/tenants/{tenantId}/academic`. It uses the existing session guard and transaction-local tenant context. Resource endpoints never accept an actor from the request. The read model returns normalized entities rather than a single polymorphic class tree.

Before a structure update or archive, a database trigger saves its complete prior row in `academic_structure_history` in the same transaction. History has tenant RLS and is available from `GET /{resource}/{id}/history`. This preserves previous labels and configuration as well as stable IDs.

## Permission and resource map

Owner/admin may create, edit and archive academic structures; staff/viewer may read. Academic writes are checked in both the API and RLS. Resource-specific accepted fields are enumerated in `src/academic.ts`. Phase 2 retains the Phase 1 tenant-wide role model; campus assignment does not itself grant or restrict access.
