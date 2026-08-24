# P0 Tenancy + Authorization Spine

**Status:** First implementation wave  
**Target packages:** `@expadio/tenancy`, `@expadio/authorization`

## Objective

Create the smallest executable EXPADIO policy spine that can safely receive later BEMP capability, CRM, workflow and vertical migrations.

This is a **normalization layer**, not a wholesale copy of any source repository.

## Source evidence

### BEMP — canonical base

Primary concepts retained from BEMP:

- explicit tenant/brand/actor context
- production identity must come from verified OIDC rather than development headers
- transaction/database context is tenant-scoped
- capability/entitlement decisions are distinct from authentication
- SoD/authority already exists in Decision Fabric and must remain a veto/constraint layer

Primary source areas audited:

- `apps/core/src/tenancy/*`
- `apps/core/src/database/tenant-database.ts`
- `apps/core/src/security/services/security-policy.service.ts`
- `apps/core/src/decision-fabric/roles/*`
- `apps/core/src/capabilities/*`

### GFSM — authorization semantics

Semantics imported into the canonical model:

- action scope vs broader visibility scope
- resource-state-aware authorization
- field/data classification and sensitive compartments
- explainable denial stage/reason
- segregation-of-duties as a **final veto**, never a grant

Primary source:

- `packages/ps7-access/src/resolver.ts`

### DENTEX — active operating context

DENTEX current HEAD confirms the usefulness of an explicit organization/location execution context and database-scoped request GUCs.

Semantics imported:

- identity is separate from selected organization/location context
- a caller cannot simply select a context without a valid membership
- public execution is a distinct mode and will be implemented separately from tenant execution

Primary source areas:

- `apps/api/src/index.ts`
- `apps/core/src/index.ts`

### LIMS — defence-in-depth requirement

LIMS provides evidence that authorization must compose with database isolation and subject/relationship scoping in regulated domains.

Semantics reserved by this contract:

- tenant denial occurs before role evaluation
- relationship may be an explicit authorization gate
- later DB/RLS enforcement must backstop, not replace, application authorization

## `@expadio/tenancy`

The first tenancy contract models:

```text
verified identity
+ requested tenant
+ requested organization
+ optional workspace
+ optional operating unit
+ verified membership set
= EffectiveContext
```

The resolver fails closed on:

- missing tenant/organization membership
- workspace outside membership scope
- operating unit outside membership scope

No vertical vocabulary such as clinic, franchise, laboratory or employer is used in the core contract.

## `@expadio/authorization`

The first authorization pipeline is:

```text
TENANT
 -> CAPABILITY
 -> ENTITLEMENT
 -> SCOPE
 -> RESOURCE_STATE
 -> CLASSIFICATION
 -> RELATIONSHIP
 -> RESTRICTION
 -> SOD
```

### Invariants

1. **Tenant mismatch denies first.** A role never repairs cross-tenant access.
2. **Visibility is not mutation authority.** `visibilityScope` may exceed `actionScope` for hierarchical read experiences.
3. **Entitlement is separate from role capability.** A role grant cannot bypass a plan/capability entitlement required by an operation.
4. **Resource state can narrow an otherwise valid capability.**
5. **Classification can narrow an otherwise valid role.** Sensitive compartments require explicit compartment clearance.
6. **Relationship can be required by an operation.** This creates a generic hook for patient/provider/employer/partner/customer relationships without hard-coding their names.
7. **Restrictions subtract authority.** They never add it.
8. **SoD runs last and can only veto.** It never creates authority.
9. **Every denial is explainable.** Decisions return a stable `stage`, `reasonKey` and human-readable reason.

## Initial regression tests

The first suite proves:

- caller-selected organization without membership is rejected
- operating unit outside membership scope is rejected
- cross-tenant resource access is rejected before roles are considered
- visibility scope can include a subordinate unit without granting approve authority there
- blocked resource state prevents approval
- sensitive compartment mismatch denies access
- missing required entitlement denies access
- explicit restrictions subtract authority
- resource owner cannot approve their own resource when the SoD rule is enabled

## Deliberate non-goals in this wave

Not implemented yet:

- identity-provider adapter / Clerk integration
- database schema or RLS
- persistent memberships
- persona resolution
- hierarchical relationship graph
- delegated grants
- restriction persistence/expiry
- policy DSL
- capability registry integration
- audit sink integration
- Decision Fabric integration
- platform impersonation/support access

Those are subsequent P0 layers. The purpose of this wave is to freeze the contract shape and regression floor first.

## Next integration order

1. Persist canonical tenant/organization/membership data.
2. Add verified identity adapter interface; provider implementation remains replaceable.
3. Add authorization audit sink and mandatory sensitive-read/denial policy.
4. Bind BEMP Capability Fabric entitlements/bindings into `requiredEntitlement` resolution.
5. Add relationship and delegation resolution.
6. Add Postgres transaction context + RLS backstop and cross-tenant integration tests.
7. Integrate authorization with Decision Fabric actions and AI/agent tool calls.

## Rollback

This wave adds new packages and workspace configuration only. Source repositories remain untouched. Rollback is branch/commit removal; no data migration exists in this wave.