# P0 Capability Fabric — State Resolver

**Status:** Second implementation wave  
**Target package:** `@expadio/capabilities`

## Objective

Promote the deterministic BEMP Capability Fabric state machine into EXPADIO before introducing provider SDKs, credentials or persistent registry migrations.

## Canonical source

Primary BEMP sources audited:

- `apps/core/src/capabilities/entities/capability.entity.ts`
- `apps/core/src/capabilities/entities/tenant-capability-binding.entity.ts`
- `apps/core/src/capabilities/services/capability-state-resolver.service.ts`
- `apps/core/src/capabilities/services/capability-bound-impact.service.ts`
- `docs/capabilities/s2-registry-schema-migration-plan.md`

EXPADIO provider architecture remains defined by `docs/architecture/PROVIDER-ABSTRACTION-BYOK-BYOC.md`.

## State model

The first normalized resolver preserves the BEMP state vocabulary:

```text
PLATFORM_DEFAULT
ACTIVE
PENDING_PROOF
DEGRADED
VIOLATING
SUSPENDED
LOCKED_BY_PLAN
NOT_CONFIGURED
```

The resolution precedence is deliberate:

```text
plan entitlement
 -> configured bounds / grace
 -> mode selection
 -> mode permission
 -> platform-default handling
 -> provider/configuration proofs
 -> effective capability state
```

A later provider or proof cannot repair a missing plan entitlement, and a role cannot repair a capability that is suspended or locked.

## Modes

The package preserves BEMP's abstract modes `A | B | C | D` without inventing new semantics for B/C/D during this wave.

Only the verified BEMP behavior is frozen here:

- Mode `A` resolves to `PLATFORM_DEFAULT` after entitlement/bounds/mode validation.
- Other permitted modes are evaluated against their proof set.

Provider ownership labels such as managed/BYOK/BYOC will be mapped onto these modes only when the provider registry/control-plane contract is implemented and verified.

## Proof behavior

- all required proofs matched → `ACTIVE`
- some matched and some incomplete/failed → `DEGRADED`
- pending without matched proof → `PENDING_PROOF`
- failed without matched proof → `PENDING_PROOF` with explicit `PROOFS_FAILED` reason

`DEGRADED` is considered operational at the generic state level, but individual operations may later impose stricter proof/capability requirements.

## Bounds and grace

A capability outside configured bounds resolves to:

- `VIOLATING` during the grace period
- `SUSPENDED` once grace has expired

The result carries:

- stable reason key
- blocking setup step
- blocking bound key
- explicit consequence if no action is taken

This is designed to connect later to BEMP's impact-preview behavior and EXPADIO business configuration changesets.

## Initial regression tests

The suite proves:

- missing plan entitlement locks the capability before provider evaluation
- a bound violation enters `VIOLATING` during grace
- expired grace becomes `SUSPENDED`
- missing or disallowed modes are rejected
- Mode A becomes `PLATFORM_DEFAULT`
- fully matched proofs activate the capability
- partial proof coverage produces operational `DEGRADED`
- pending/failed proof-only states remain non-operational

## Deliberate non-goals

Not implemented in this wave:

- database registry tables
- connector registry
- credential references or vault/KMS
- proof collectors
- provider health/routing
- external-account grants
- capability-state persistence/history
- automatic invalidation jobs
- authorization entitlement adapter
- frontend setup/remediation UX

These are subsequent Capability Fabric layers.

## Rollback

This wave is additive and contains no data migration or provider credential handling. Rollback is commit removal only.