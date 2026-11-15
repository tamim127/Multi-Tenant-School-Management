# Permission matrix

Permissions are evaluated for each tenant membership. There are no global platform-admin HTTP endpoints. Public registration produces no membership; any authenticated user may provision a School tenant and becomes its owner.

| Operation                                    | Owner | Admin | Staff | Viewer | Nonmember |
| -------------------------------------------- | ----- | ----- | ----- | ------ | --------- |
| Read tenant, campuses, members, tenant users | Yes   | Yes   | Yes   | Yes    | No        |
| Read effective permissions                   | Yes   | Yes   | Yes   | Yes    | No        |
| Rename tenant                                | Yes   | No    | No    | No     | No        |
| Create/update campus                         | Yes   | Yes   | No    | No     | No        |
| Add/update/remove staff or viewer            | Yes   | Yes   | No    | No     | No        |
| Add/update/remove admin                      | Yes   | No    | No    | No     | No        |
| Change/remove owner or promote to owner      | No    | No    | No    | No     | No        |
| Read audit events                            | Yes   | Yes   | No    | No     | No        |
| Modify/delete audit events                   | No    | No    | No    | No     | No        |

The `read`, `campus:write`, `membership:write`, `tenant:write`, and `audit:read` permission vocabulary is defined in SQL `app.has_permission`. Membership policies add target-role constraints: an admin cannot change itself or another admin, and nobody can change the owner through ordinary membership CRUD. `membership:write` alone does not authorize all role transitions. Owner transfer will need a separate audited workflow.

Every authenticated user can read/edit their own profile and list/revoke their own sessions. A tenant owner cannot read another user's credentials or revoke another user's sessions through the API. Staff and viewer intentionally have the same foundation permissions; later domain modules will distinguish them.

Database SELECT policies hide unauthorized rows. API nonmembership is an explicit 403. Authorized-tenant updates against hidden or absent records return 404 without revealing existence; denied INSERT/role changes return 403. Staff/viewer audit queries return an empty collection. Mutations emit audit events in the same transaction.
