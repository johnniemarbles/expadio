# P0 Provider Registry + Capability Persistence

**Status:** Implementation slice

## Purpose

Establish the provider-neutral Infrastructure Control Plane boundary required by EXPADIO before any vendor SDK, raw credential, or vertical-specific provider integration is introduced.

This slice follows the verified repository extraction rule: BEMP remains the canonical source for Capability Fabric concepts; EXPADIO normalizes them with the provider-abstraction, tenancy, authorization and regulated-system hardening rules already merged into `main`.

## Source evidence

Primary BEMP source material:

- `docs/capabilities/s2-registry-schema-migration-plan.md`
- `infra/db/migrations/0099_capabilities_m1_vault_and_schema_qualification.sql`
- existing BEMP capability state resolver promoted in P0 Capability Fabric

EXPADIO architecture contract:

- `docs/architecture/PROVIDER-ABSTRACTION-BYOK-BYOC.md`

Cross-repository hardening inputs:

- DENTEX: scoped organization/location database context
- LIMS: fail-closed tenant isolation and persistence verification in CI
- GFSM: deterministic/explainable state and governance semantics

## Target packages

### `@expadio/provider-registry`

Owns provider/connector selection contracts:

- provider type and provider key
- platform-owned vs tenant-owned connector scope
- capability support
- external credential reference
- region
- residency tags
- compliance tags
- connector health
- priority
- enabled/fallback metadata
- tenant/capability routing policy

Routing is fail-closed. A fallback cannot bypass region, residency, compliance, connector allow/deny policy, tenant ownership, enabled state, or health constraints.

### `@expadio/capability-persistence`

Owns the persistence boundary around `@expadio/capabilities`:

- deterministic normalized input hash
- current capability-state snapshot
- optimistic version contract
- idempotent repeated resolution
- atomic snapshot + transition-event commit contract
- append transition only when effective state/reason changes

The repository interface is deliberately storage-neutral. PostgreSQL is the first adapter contract, not a domain dependency.

## PostgreSQL schema

Migration:

`infra/db/migrations/0001_platform_capability_registry.sql`

Creates:

- `platform.capabilities`
- `platform.connectors`
- `platform.connector_capabilities`
- `platform.connector_credentials`
- `platform.connector_routing_policies`
- `platform.tenant_capability_bindings`
- `platform.capability_proofs`
- `platform.capability_state`
- `platform.capability_state_events`

### Credential rule

EXPADIO intentionally tightens the older BEMP migration design.

The application registry stores only:

`credential_ref`

Accepted references are external secret-manager identifiers such as:

- `secret://...`
- `vault://...`
- `kms://...`
- `provider-secret://...`

There is no `encrypted_payload`, raw API key, secret, password, or provider credential payload column in the domain registry.

Actual secret material belongs in the configured vault/KMS/provider secret service and is supplied only to the adapter that needs it.

## Tenant isolation

Tenant-bearing persistence tables use PostgreSQL Row-Level Security and `FORCE ROW LEVEL SECURITY`.

The database session contract is:

`SET LOCAL app.tenant_id = '<tenant uuid>'`

`platform.current_tenant_id()` reads that scoped value.

Platform connectors are visible across tenants; tenant-owned connectors are visible only to their tenant. Tenant bindings, proofs, state and state events are tenant-isolated.

Connector credentials are not granted to the ordinary application/read role by the smoke test. Secret resolution belongs behind the provider-adapter service boundary.

## State history rule

`platform.capability_state` is the latest authoritative snapshot.

`platform.capability_state_events` is append-only. UPDATE and DELETE are rejected by trigger and binding deletion is restricted while state events exist.

This is an application/database append-only control. It is **not** described as storage-level WORM or administrator-proof immutability.

## CI evidence

`Core Spine` now has two jobs:

1. TypeScript typecheck + regression suite.
2. PostgreSQL 16 contract test applying the migration and executing `infra/db/tests/capability_registry_smoke.sql`.

The database smoke test verifies:

- migration applies successfully
- no credential payload column exists
- state-event append-only trigger exists
- tenant RLS is forced
- tenant A sees platform + tenant A connectors but not tenant B connector
- tenant A sees only its binding/state/events
- state-event mutation is rejected

## Non-goals

This slice does not yet implement:

- vendor SDK adapters
- vault/KMS client integration
- UI/provider setup screens
- health-probe workers
- cost-based routing
- automatic failover execution
- persistent organization/membership tables
- Postgres repositories in application runtime code
- Decision Fabric execution persistence

## Next implementation boundary

After this slice is green and merged:

1. persistent tenant/organization/membership model + RLS context adapter
2. Postgres repositories implementing the capability-state persistence interface
3. provider registry repository + secret resolver interface
4. Capability Fabric ↔ Authorization binding (`capability operational?` + `actor authorized?`)
5. Decision Fabric persistence and audit integration

## Rollback

- revert this implementation PR
- drop the `platform` schema in a disposable/pre-production database if the migration was applied there
- no source repository is modified
- no vendor credential material is migrated by this slice
