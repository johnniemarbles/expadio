# P0 PostgreSQL Runtime Adapters

**Status:** Implementation slice

## Purpose

Turn the previously merged tenancy and Capability Fabric persistence contracts into executable PostgreSQL repository adapters without coupling domain packages to a specific Node database driver.

## Target package

`@expadio/postgres-runtime`

The package defines a small structural client contract compatible with `node-postgres` Pool / PoolClient and similar PostgreSQL drivers. Domain packages remain driver-free.

## Implemented adapters

### Membership repository

`PostgresMembershipRepository` implements the `MembershipRepository` contract from `@expadio/tenancy-persistence`.

It calls only:

`platform.active_memberships_for_subject(subject_id, issuer)`

The result is normalized back into core `MembershipContext` semantics:

- `ALL` workspace/unit scope -> property omitted
- `SELECTED` -> explicit list, including an empty list when nothing is selected

### Capability state repository

`PostgresCapabilityStateRepository` implements `CapabilityStateRepository`.

It supports:

- current snapshot load under tenant RLS
- first insert guarded by conflict detection
- optimistic version update
- concurrency conflict surfaced as `CAPABILITY_STATE_CONCURRENCY_CONFLICT`
- transition event append only after a successful snapshot mutation

The repository is intentionally used inside an outer request transaction. That makes snapshot mutation and state-event append atomic with the business work that caused them.

## Request transaction boundary

`withEffectiveContextTransaction(pool, context, work)`:

1. acquires one PostgreSQL client
2. `BEGIN`
3. binds the already verified `EffectiveContext` through parameterized `set_config(..., true)` calls
4. executes work on the same connection
5. commits on success
6. rolls back on failure
7. releases the client

Because RLS context is connection-local/transaction-local, a request must never share one client concurrently with another request.

## Membership bootstrap problem

Tenant RLS cannot be trusted before membership is verified. Conversely, membership cannot be discovered by first trusting a caller-selected tenant.

Migration:

`infra/db/migrations/0003_membership_bootstrap.sql`

solves this with a narrow pre-tenant path.

### Subject-scoped forced RLS

Before tenant context exists, the trusted application may bind only identity facts derived from authentication:

- `app.subject_id`
- `app.issuer`

Additional SELECT policies permit that subject to see only its own active membership graph. These policies cover memberships plus the tenant/organization/scope rows needed to validate it.

### Bootstrap function

`platform.active_memberships_for_subject(text, text)`:

- has a fixed search path
- sets only subject + issuer transaction-local context
- returns active/current memberships
- filters suspended/inactive tenant and organization records
- returns selected workspace / operating-unit scope
- has PUBLIC execution revoked
- must be granted only to the trusted runtime role

The function does not depend on superuser, table-owner, or `BYPASSRLS` behavior; subject-scoped RLS remains the portability boundary.

## Security boundary

The database cannot determine whether an arbitrary string is a genuinely authenticated identity by itself. The composition root must therefore pass `subject_id` / `issuer` only from a verified identity token/session.

The runtime flow is:

```text
identity provider verification
        -> subject + issuer
        -> membership bootstrap
        -> @expadio/tenancy effective-context verification
        -> BEGIN request transaction
        -> bind tenant/org/workspace/unit with set_config(..., true)
        -> normal RLS-protected repositories
        -> COMMIT / ROLLBACK
```

No HTTP header, query parameter, browser-selected account, or vertical module is authoritative for tenant context.

## Validation

TypeScript tests cover:

- bootstrap function invocation/mapping
- ALL vs SELECTED scope semantics
- parameterized DB setting binding
- BEGIN -> bind -> work -> COMMIT ordering
- rollback + release behavior
- capability-state snapshot mapping
- optimistic concurrency failure
- snapshot-before-event mutation ordering

PostgreSQL contract smoke tests additionally prove:

- subject-only membership visibility with `app.tenant_id` unset
- tenant/organization/scope rows cannot cross subject boundaries during bootstrap
- bootstrap function is not executable by the runtime role until explicitly granted
- normal tenant-bound RLS still works after bootstrap
- all prior capability/tenancy migration smoke tests remain green

## Non-goals

This slice does not yet add:

- a specific `pg` Pool construction/configuration module
- connection-string/secrets resolution
- HTTP/NestJS/Next.js request middleware
- retries around serializable/deadlock failures
- provider-registry SQL repository
- authorization role/assignment persistence
- Decision Fabric persistence

## Next boundary

1. bind Capability Fabric operational state into Authorization as one composed access decision
2. provider-registry SQL repository + external secret resolver interface
3. persisted role/assignment/delegation model
4. Decision Fabric persistence and audit integration
