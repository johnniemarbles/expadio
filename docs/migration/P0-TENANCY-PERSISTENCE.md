# P0 Tenancy Persistence

**Status:** Implementation slice

## Purpose

Persist the tenant / organization / membership context that the already-merged `@expadio/tenancy` and `@expadio/authorization` layers depend on, while keeping authentication provider-backed and authorization separate.

## Source normalization

Primary BEMP source:

- `infra/db/migrations/0069_core_platform_foundation.sql`

BEMP established tenants, users, tenant memberships and provider identities. EXPADIO generalizes this into identity subjects and organizations so the core is not tied to a specific vertical or to a human-user-only model.

## Target model

PostgreSQL migration:

`infra/db/migrations/0002_tenancy_memberships.sql`

Creates:

- `platform.tenants`
- `platform.organizations`
- `platform.workspaces`
- `platform.operating_units`
- `platform.memberships`
- `platform.membership_workspaces`
- `platform.membership_operating_units`

The membership record proves that an identity subject belongs to a tenant + organization. It does not grant application permissions; roles, capabilities, restrictions and SoD remain owned by authorization.

## Identity model

Memberships store:

- `subject_id`
- `actor_kind`: user | party | service | agent
- optional `issuer`

The external identity provider remains authoritative for authentication. EXPADIO persists the application-side binding from verified subject to tenant/organization scope.

## Scope semantics

Workspace and operating-unit scope are explicit:

- `ALL`
- `SELECTED`

Selected scope uses junction tables. This avoids treating an empty list ambiguously as either “none” or “all”.

## RLS contract

All tenant-bearing tenancy tables use PostgreSQL RLS with `FORCE ROW LEVEL SECURITY`.

The trusted application layer must first resolve an `EffectiveContext` from verified membership and only then bind transaction-local settings:

- `app.tenant_id`
- `app.subject_id`
- `app.organization_id`
- optional `app.workspace_id`
- optional `app.operating_unit_id`
- optional `app.correlation_id`

The package `@expadio/tenancy-persistence` provides the repository bridge and narrow transaction-context binder contract. It never accepts an arbitrary caller-selected tenant as trusted context without passing through `@expadio/tenancy` membership resolution.

## Cross-core integrity

Migration 0002 also attaches tenant/organization foreign keys to the Capability Fabric persistence introduced in migration 0001. Capability bindings therefore cannot point at a tenant or organization that does not exist.

## CI evidence

`Core Spine` now applies every migration in lexical order and runs every database smoke test in lexical order.

`infra/db/tests/tenancy_memberships_smoke.sql` verifies:

- tenant A cannot see tenant B organizations or memberships
- membership workspace/unit rows remain tenant-isolated
- subject and organization transaction context are readable through platform helper functions
- membership RLS is both enabled and forced

## Non-goals

This slice does not yet implement:

- identity-provider SDK integration
- login/session handling
- authorization role assignments in SQL
- delegated access
- hierarchy traversal permissions
- organization switcher UI
- repository implementation against a specific Node Postgres driver

## Next boundary

1. PostgreSQL repository adapters for tenancy and Capability Fabric
2. atomic request transaction context (`SET LOCAL`) in the application composition root
3. bind Capability Fabric operational state into Authorization evaluation
4. Decision Fabric persistence + audit trail
