# P0 Access + Capability Composition

**Status:** Implementation slice

## Purpose

Compose two already-merged EXPADIO decisions without collapsing their responsibilities:

1. **Authorization:** may this actor perform this action on this resource?
2. **Capability Fabric:** is the underlying platform capability operational for the tenant?

Both must pass before an operation can proceed.

## Package

`@expadio/access-control`

## Evaluation order

Authorization runs first.

This is deliberate: a caller who is not authorized to perform an action must not learn the tenant's provider configuration or capability state as a side channel.

```text
Effective Context
      -> Actor Authorization
           deny -> return authorization denial
           allow
              -> Required Platform Capability?
                    no -> allow
                    yes -> Capability State Gate
                              operational -> allow
                              non-operational -> deny
```

## Operational states

The composition reuses `@expadio/capabilities.isOperationalState()`.

Operational by default:

- `ACTIVE`
- `PLATFORM_DEFAULT`
- `DEGRADED`

Non-operational:

- `PENDING_PROOF`
- `VIOLATING`
- `SUSPENDED`
- `LOCKED_BY_PLAN`
- `NOT_CONFIGURED`

## Degraded policy

`DEGRADED` is usable by default because Capability Fabric explicitly models it as operational.

Individual actions may declare:

`degradedPolicy: 'DENY'`

for operations that require full readiness. This avoids globally turning a partially degraded provider into an outage while still allowing high-risk operations to fail closed.

## Decision shape

A composed denial caused by platform availability uses:

`stage = PLATFORM_CAPABILITY`

and surfaces:

- capability key
- capability state
- stable reason key
- optional blocking step

An authorization denial does **not** surface capability key/state.

## Mapping from Capability Fabric

`requiredPlatformCapability(capabilityKey, resolvedState)` converts a `ResolvedCapabilityState` directly into the composed access requirement without duplicating state resolution rules.

## Examples

### Authorized actor + ACTIVE capability

Allowed.

### Authorized actor + SUSPENDED capability

Denied at `PLATFORM_CAPABILITY`.

### Unauthorized actor + SUSPENDED capability

Denied at the actor authorization stage. Capability configuration is not exposed.

### Authorized actor + DEGRADED capability

Allowed by default and returned with `degraded: true`.

### Authorized actor + DEGRADED capability + full-readiness action

Denied at `PLATFORM_CAPABILITY`.

## Architectural invariant

A permission grant can never make an unavailable platform capability operational.

Conversely, an operational platform capability can never grant an actor permission.

The two controls remain independent and subtractive.

## Next boundary

After this slice:

1. provider-registry PostgreSQL repository + secret resolver interface
2. persisted authorization assignments / restrictions / delegations
3. Decision Fabric persistence and audit integration
4. application composition root that loads context, actor policy and capability state inside one transaction
