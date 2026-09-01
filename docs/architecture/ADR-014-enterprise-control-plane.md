# ADR-014 — Enterprise Control Plane

- **Status:** Accepted for implementation
- **Date:** 2026-09-01
- **Scope:** EXPADIO core platform
- **Supersedes:** no prior ADR; formalizes the enterprise model previously demonstrated in BEMP

## Decision

EXPADIO separates five concepts that must never collapse into one table or one parent edge:

1. **Tenant** — security, customer-account, subscription, and commercial-entitlement boundary.
2. **Enterprise profile** — corporate/economic group being configured.
3. **Legal entity** — registered corporation, partnership, JV company, or other legal person.
4. **Organization** — operational authority node such as Global HQ, Country Operations, Master Franchise, Region, or City.
5. **Brand** — market-facing identity.

Workspaces and operating units remain execution contexts beneath organizations.

The tenant remains the commercial module-entitlement boundary. Enterprise and organization scope control authority, activation, configuration, and inheritance beneath that entitlement.

## Canonical topology

```text
Platform
  -> Tenant
      -> Enterprise profile
          -> Legal entity graph
          -> Operational organization tree
              -> Workspace / operating unit
          -> Commercial appointments / rights / territory
          -> Jurisdiction activation
      -> Brand(s)
      -> Product module entitlement
```

## Three different parent concepts

The platform MUST keep these separate:

- `parent_legal_entity_id` — ownership/corporate structure.
- `parent_organization_id` — operational delegation/authority hierarchy.
- sponsoring/approving organization — governance relationship for a requested change.

A franchisee, licensee, distributor, or JV operator MUST NOT be represented as a subsidiary merely because it is operationally below a parent organization.

## Existing foundations retained

EXPADIO keeps and extends:

- `platform.tenants`
- `platform.organizations`
- `platform.workspaces`
- `platform.operating_units`
- `platform.memberships`
- forced tenant RLS
- `platform.entity_relationships`
- workflow / decision fabrics
- domain events + transactional outbox
- product module catalogue / tenant entitlement / tenant install separation
- org-scoped capability bindings

BEMP enterprise code is a domain and UX reference only. Browser-local persistence and archived BEMP migrations are not production persistence.

## Enterprise persistence

The first production slice introduces:

- `platform.enterprise_profiles`
- `platform.legal_entities`
- `platform.legal_entity_registration_identifiers`
- `platform.legal_entity_addresses`
- `platform.legal_entity_classifications`
- `platform.legal_entity_business_functions`
- `platform.ownership_interests`
- `platform.beneficial_owners`
- `platform.organization_legal_entity_bindings`
- `platform.organization_closure`
- `platform.enterprise_change_requests`
- `platform.membership_organizations`

Legal entities remain distinct from `platform.crm_accounts`. CRM associations require an explicit verified relationship rather than identity-by-row reuse.

## Hierarchy integrity

Organization hierarchy is tenant-local and cycle-free.

A closure table is maintained as a read model for ancestor/descendant traversal. The source of truth remains `platform.organizations.parent_organization_id`.

Membership hierarchy scope modes are:

- `SELF`
- `DESCENDANTS`
- `SELF_AND_DESCENDANTS`
- `SELECTED`

Existing memberships migrate to `SELF`, preserving prior exact-organization behavior.

## Governed change model

High-impact enterprise mutations are requests, not immediate structural writes.

Supported operations begin with:

- `CREATE_ORGANIZATION`
- `REPARENT_ORGANIZATION`
- `CREATE_LEGAL_ENTITY`
- `CHANGE_OWNERSHIP`
- `CHANGE_OPERATING_ENTITY`
- `APPOINT_PARTNER`
- `EXPAND_TERRITORY`
- `ACTIVATE_JURISDICTION`
- `SUSPEND_ORGANIZATION`

Request lifecycle:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW
                   -> CHANGES_REQUESTED
                   -> APPROVED
                   -> REJECTED
                   -> CANCELLED
```

Approval is deliberately separate from operational activation.

Organization lifecycle becomes:

```text
PROVISIONING -> CONFIGURING -> READY_FOR_ACTIVATION -> ACTIVE
                                         |             |
                                         +-> SUSPENDED +
                                         +-> CLOSED
```

## Search Before Create

Legal-entity identity is governed by jurisdiction plus normalized registration identity. The database prevents duplicate active identifiers for:

`tenant + jurisdiction + identifier_type + normalized_registration_identifier`.

The UI must search before creating a new legal entity.

## Authorization

Effective enterprise authority is the intersection of:

```text
role permission
AND organization scope
AND delegated authority
AND territory rights
AND commercial rights
AND active membership
AND capability/module state
```

Child authority can never exceed parent authority.

The initial persistence slice does not invent a new approval engine. Existing workflow and governance primitives remain the decision engine; `enterprise_change_requests` is the enterprise business object linked to that decision path.

## Configuration and modules

Commercial module entitlement remains tenant scoped:

```text
product module
 -> tenant entitlement
 -> tenant install
 -> enterprise/org activation policy
 -> user permission
```

Enterprise hierarchy must not create a competing entitlement system.

Governed settings may later resolve through:

```text
Platform -> Plan -> Vertical -> Tenant -> Enterprise -> Brand -> Organization -> Workspace
```

but every setting definition decides which levels are legal.

## Invariants

Release is blocked if any of these fail:

1. cross-tenant enterprise access;
2. legal entity / CRM account conflation;
3. legal parent / operational parent conflation;
4. organization cycles;
5. sibling-scope leakage;
6. child authority exceeding parent authority;
7. duplicate registration identity;
8. approval automatically activating an organization;
9. unaudited material enterprise mutations;
10. module activation bypassing tenant entitlement.

## Follow-on slices

1. Enterprise persistence and hierarchy foundation.
2. Parent-governed change execution and SoD.
3. Persisted organization onboarding/readiness journeys.
4. Commercial appointments, agreements, rights, territory, jurisdiction activation.
5. Enterprise Hub UI and BEMP parity fixtures.
