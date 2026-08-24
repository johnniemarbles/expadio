# DENTEX Extraction Map

**Status:** Verified source audit baseline  
**Source repository:** `johnniemarbles/dentexnew`  
**Target:** EXPADIO vertical + selected reusable patterns

## Executive decision

DENTEX is **not** a competing EXPADIO core. It is the primary source for the `dentex` vertical and contains several mature architectural patterns that should inform or harden EXPADIO core boundaries.

Current HEAD is materially stronger than the older hardening roadmap suggests: the API now connects to a real PostgreSQL pool, fails closed when the database is unavailable, and passes tenant context through transaction-local GUCs.

The extraction rule is therefore:

- preserve dental domain objects and terminology under `verticals/dentex`
- promote only genuinely reusable infrastructure or semantics
- do not create a second workflow, authorization, communication, event, or tenancy engine
- prefer BEMP/EXPADIO canonical engines and adapt DENTEX behavior into them

## Verified architecture

DENTEX uses an engine-oriented backend with separated identity, organization, authorization, operations, workflow, event/audit and domain engines. The current API composition root:

- creates a real `pg.Pool`
- validates database connectivity at startup
- refuses to boot when persistence is unavailable
- registers all engines against the live database

The shared `DbRunner` provides:

- parameterized queries
- `withContext()` transactions
- `SET LOCAL app.org_id`
- optional `app.clinic_id`
- optional `app.user_id`
- read-only anonymous `withPublicContext()`
- explicit per-request `EngineContext`

This is useful reference material for EXPADIO tenancy and public-data isolation, but BEMP remains the canonical source for the core tenant/database layer.

## Promote as patterns into EXPADIO core

### 1. Active-context tenancy

DENTEX correctly distinguishes global identity from the organization/location context in which an action occurs.

Promote the semantic rule:

```text
identity
  + organization
  + operating location/context
  + membership/relationship
  -> effective request context
```

Target: `packages/tenancy` + `packages/authorization`.

Do not copy dental names such as `clinic` into core. EXPADIO should represent the location/business-unit dimension generically and let a vertical label it.

### 2. Restricted public read context

DENTEX's public directory path uses a distinct, read-only anonymous transaction context instead of pretending public reads are tenant reads.

Promote the contract:

- public access is an explicit execution mode
- public mode is read-only by default
- public resources require explicit publication state
- public access never inherits a caller-selected tenant

Target: `packages/tenancy` / application API policy layer.

### 3. Delegation, restrictions and break-glass concepts

DENTEX architecture explicitly separates:

- base role authority
- restrictions that subtract authority
- delegations that temporarily add bounded authority
- emergency/break-glass access with audit

Promote these semantics into the canonical EXPADIO authorization contract. Do not migrate a second authorization runtime.

Target: `packages/authorization`.

### 4. Engine operation contract

Useful concepts from the DENTEX engine model:

- operation-local input schema
- normalized error contract
- common request context
- domain operations that emit events rather than directly coordinating every downstream module

Adopt where useful in `apps/api` and package application services, without forcing every EXPADIO package to use DENTEX's exact `Engine` abstraction.

### 5. Directory/listing provenance model

The DENTEX directory specification contains a strong generic model:

```text
public listing != tenant-owned business object
```

A listing may exist before any account or tenant claims it. Claiming binds the public record to a governed organization/location rather than converting or destroying the original listing.

Also reusable:

- per-attribute source provenance
- per-attribute retention policy
- claim-confidence signals
- contested-claim handling
- four-eyes override
- revocation while preserving history
- deterministic/explainable scoring
- AI used for extraction/triage, not as the authoritative numeric score

Candidate target after a second vertical proves reuse: `modules/directory` or `packages/directory`.

Until then, implement first under `verticals/dentex` behind generic interfaces.

## Verticalize under `verticals/dentex`

The following remain dental/healthcare vertical capabilities unless separately generalized by another proven use case:

- patients
- dental providers
- clinical records
- dental appointments
- treatment plans
- prescriptions
- recalls
- imaging
- dental insurance/billing rules
- lab-case dental workflow
- PMS bridge
- dental inventory semantics
- CE/accreditation-specific content
- clinic/provider directory ontology
- dental trust-score inputs

## Do not promote as horizontal implementations yet

The earlier extraction matrix overstated several DENTEX horizontal capabilities.

### Academy / LMS

`web-academy` is currently an experience prototype with hard-coded course/quiz data and client-local enrollment/progress state. It is **not yet a reusable LMS backend**.

Decision: **REFERENCE UI / VERTICAL PROTOTYPE**, not `modules/lms` source of truth.

### Jobs

`apps/jobs` is a background operational scheduler for recalls, AR snapshots, reminders, claim follow-up, inventory checks and similar cron-style work. It is **not a recruiting/jobs marketplace engine**.

Decision: extract only generic scheduling lessons if superior; do not classify it as the horizontal Jobs module.

### Community

No verified reusable community backend was found in the audited source. `web-social` is not sufficient evidence of a horizontal community service.

Decision: do not claim DENTEX as the source for `modules/community` until a real domain/persistence implementation is verified.

### Marketplace

`web-market` exists as an experience surface, but the audit did not establish a reusable generic marketplace core mature enough to promote.

Decision: keep as reference until persistence, transaction, catalog, order and provider boundaries are verified.

## DENTEX extraction sequence

1. Reuse EXPADIO IAM/tenancy/authorization and map DENTEX organization/location memberships onto it.
2. Reuse EXPADIO Decision Fabric; adapt dental workflows as vertical blueprints.
3. Map DENTEX CRM/people concepts onto EXPADIO CRM where semantically compatible.
4. Place clinical objects and services under `verticals/dentex`.
5. Reuse EXPADIO communication, audit, storage and provider gateways.
6. Add directory/claim features in the vertical first; promote only after cross-vertical reuse is proven.
7. Treat Academy, Market, Recruit and Social UIs as reference experiences unless their backend contracts are independently verified.

## Migration safety

Every extracted DENTEX capability must document:

- source path
- source commit
- target EXPADIO boundary
- data ownership
- tenant/location scoping
- authorization policy
- migration/adapter strategy
- tests proving no cross-tenant or cross-context leakage

Do not copy the DENTEX monorepo wholesale.