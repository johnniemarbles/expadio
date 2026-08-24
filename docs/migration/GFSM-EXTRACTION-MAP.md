# GFSM Extraction Map

**Status:** Verified source audit baseline  
**Source repository:** `johnniemarbles/gfsm`  
**Target:** semantic/test hardening of EXPADIO authorization, workflow, audit and business configuration

## Executive decision

GFSM contains a compact, well-tested governance spine, but it is **not** the EXPADIO core runtime and must not become a second workflow, audit, authorization or tenancy platform beside BEMP.

Use GFSM as a source of **precise semantics, invariants and regression tests**. Absorb those ideas into the canonical BEMP-derived EXPADIO packages.

The strongest reusable concepts are:

- action scope separated from visibility scope
- capability → scope → state → classification → SoD authorization pipeline
- field classification and sensitive compartments
- denial explanations naming the failed stage
- segregation-of-duties as a final veto
- named transition criteria
- non-waivable invariant criteria
- explicit illegal-waiver detection
- reason-required transitions
- SLA clocks that exclude declared external/waiting pauses
- tamper-evident tenant-local audit hash chains
- atomic configuration changesets with referential validation

## Verified GFSM implementation

The repository's I0 prototype consists primarily of pure, storage-agnostic TypeScript domain packages:

- `@gfsm/kernel`
- `@gfsm/ps4-audit`
- `@gfsm/ps1-gates`
- `@gfsm/ps7-access`
- `@gfsm/access-audit`
- `@gfsm/m9-admin`
- `@gfsm/skeleton-demo`

The repository intentionally uses in-memory/storage-neutral implementations for the I0 semantics. This is useful for proofs and regression tests but is not evidence that EXPADIO should migrate the packages wholesale.

## Promote into `packages/authorization`

### 1. Action scope vs visibility scope

GFSM separates what an assignment may **act on** from what it may **see**.

This should become a first-class EXPADIO authorization concept:

```text
assignment.actionScope
assignment.visibilityScope
```

A regional executive may see subordinate records without gaining mutation authority over every record. This maps directly to hierarchical EXPADIO experiences.

### 2. Canonical authorization evaluation stages

GFSM's access resolver evaluates:

```text
capability
  -> scope
  -> resource state
  -> data classification
  -> segregation-of-duties veto
```

EXPADIO's broader canonical request model remains:

```text
identity
+ organization
+ persona
+ role
+ relationship
+ scope
+ resource
+ state
+ classification
+ policy
+ entitlement
+ delegation/restriction
```

GFSM contributes the evaluation discipline, not the complete model.

### 3. Field classification and compartments

Promote:

- resource classification
- optional field-level classification
- sensitive compartments
- clearance/policy checks

Examples of generic compartments may include finance, legal, compliance, health or security, but core must not hard-code GFSM franchise labels.

### 4. Explainable denial

Every authorization denial should identify a stable reason/stage suitable for UI explanation, audit and support diagnostics.

Candidate stages:

```text
IDENTITY
TENANT
RELATIONSHIP
CAPABILITY
ENTITLEMENT
SCOPE
RESOURCE_STATE
CLASSIFICATION
POLICY
DELEGATION
SOD
```

### 5. SoD as veto, never as grant

A segregation-of-duties rule may turn an otherwise allowed action into a denial. It must never grant authority that the base authorization path did not provide.

This semantic should harden BEMP's existing SoD/authority services.

## Promote into `packages/workflow`

### 1. Named gate criteria

A refused transition must return every unmet criterion rather than a generic `transition denied` response.

Decision Fabric should expose:

- criterion key
- human-readable description
- invariant/waivable flag
- current satisfaction state
- evidence/provenance

### 2. Non-waivable invariants

GFSM correctly distinguishes an ordinary criterion from an invariant criterion that can never be overridden by a waiver.

Promote this into Decision Fabric:

```text
criterion.kind = WAIVABLE | INVARIANT
```

A waiver aimed at an invariant should be rejected and audited explicitly, not silently ignored.

### 3. Reason-required transitions

Transitions such as rejection, termination, suspension, override or other high-impact terminal actions may require a structured reason code/comment before passage.

Make this blueprint-configurable, with platform/vertical invariants able to force it.

### 4. Pause-aware workflow clocks

GFSM's SLA clock subtracts declared waiting periods such as applicant/external/statutory pauses.

Promote to Decision Fabric timers:

```text
wall elapsed
- approved pause intervals
= accountable SLA elapsed
```

Every pause must have a reason/category and an audit trail.

Do not create a second `ps1-gates` engine; implement these semantics inside the canonical BEMP-derived Decision Fabric.

## Promote into `packages/audit`

### Tamper-evident chain verification

GFSM computes a canonical deterministic SHA-256 hash over each event, including the prior hash, with an independent verifier checking per-tenant sequence and chain linkage.

This is a useful optional integrity layer for EXPADIO audit exports.

Important terminology:

- hash chaining provides **tamper evidence**
- it does not provide storage immutability by itself
- true retention lock/WORM remains a provider/storage capability

Target: audit-integrity utility + external verification tooling, not replacement of BEMP outbox or primary audit persistence.

## Promote into `packages/business-config`

### Atomic configuration changesets

GFSM validates interdependent configuration edits as one unit and rejects publication when an object references another object that neither already exists nor is created in the same changeset.

Promote the general rule:

```text
DRAFT CHANGESET
 -> dependency validation
 -> policy validation
 -> impact preview
 -> atomic publish
 -> version/provenance
```

This is especially useful for:

- organizational hierarchy
- business ontology
- offerings
- territories
- roles/policies
- workflow blueprint dependencies
- capability/provider configuration

BEMP's existing capability impact-preview behavior should be integrated with this general changeset model rather than duplicated.

## Do not promote wholesale

Do not copy these GFSM packages as parallel production engines:

- `ps1-gates`
- `ps4-audit`
- `ps7-access`
- `m9-admin`

Instead:

| GFSM source | EXPADIO destination |
|---|---|
| `ps7-access` semantics/tests | `packages/authorization` |
| `ps1-gates` criteria/waiver/clock semantics | `packages/workflow` |
| `ps4-audit` hash-chain verifier | `packages/audit` |
| `access-audit` policy | authorization → audit seam |
| `m9-admin` atomic changesets | `packages/business-config` |
| kernel event vocabulary | compare/normalize with EXPADIO event taxonomy |

## What remains GFSM/franchise-specific

GFSM's franchise-sales ontology, named roles, deals, markets, offerings and domain-specific segregation rules are reference material for expansion/franchise configurations, not universal core vocabulary.

Where equivalent behavior already exists in BEMP Decision Fabric, BEMP remains authoritative and GFSM contributes tests/invariants only.

## Extraction sequence

1. Normalize EXPADIO authorization contract from BEMP.
2. Add GFSM visibility-scope, classification/compartment and explainable-denial semantics.
3. Port GFSM SoD regression cases against EXPADIO authorization.
4. Extend Decision Fabric criteria with invariant/waivable semantics and reason-required transitions.
5. Add pause-aware clocks to Decision Fabric timers.
6. Add optional audit hash-chain generation/verification around the canonical audit stream.
7. Introduce atomic versioned configuration changesets in business configuration.
8. Keep GFSM source tests as migration evidence until equivalent EXPADIO tests pass.

## Migration safety

No GFSM-derived semantic is complete until an EXPADIO regression test proves it against the canonical engine. The goal is to preserve superior behavior while reducing the number of platform engines, not increasing it.