# EXPADIO Business Configuration Extraction Audit

**Status:** P0-E0 source-verified baseline  
**Date:** 2026-08-25

## 1. Scope

This audit determines which Business Configuration capabilities already exist in BEMP and which capabilities must be introduced as new EXPADIO platform primitives.

Primary source reviewed:

- `johnniemarbles/BEMP@d18e9e674805c2cff95633f34c31896c80b9624f`
- `apps/core/src/configuration/settings.types.ts`
- `apps/core/src/configuration/settings.service.ts`

The audit is intentionally conservative: absence below means no reusable first-class core contract was verified in the reviewed source, not that a similar word never appears in specifications or vertical code.

## 2. Verified BEMP configuration capability

BEMP has a generic key/value settings resolver with three precedence sources:

```text
platform default
  <- jurisdiction override
    <- brand override
```

Verified properties:

- configuration values may be string, number, boolean, object or null
- platform defaults are mandatory for a key to resolve
- jurisdiction override is optional
- brand override is optional and takes precedence over jurisdiction
- resolution reports the winning source

This is useful as a low-level settings primitive but is not sufficient to represent EXPADIO Business Configuration.

## 3. What should be retained

### Generic configuration resolution

Promote the concept, not the current in-memory implementation.

Target EXPADIO hierarchy should become explicit and versioned:

```text
EXPADIO default
  -> Industry Pack
    -> Business Template
      -> Tenant / Brand
        -> Organization / Business Unit
          -> Jurisdiction / Territory policy where applicable
```

Not every setting should support every scope. Allowed override scopes must be declared by configuration definition.

### Deterministic precedence trace

BEMP's resolved-source concept should be expanded to a complete provenance trace including:

- definition key/version
- winning value
- source scope
- inherited values considered
- effective-from/effective-until
- resolver version
- policy restrictions

## 4. Missing first-class EXPADIO primitives

The reviewed BEMP configuration module does **not** provide verified first-class models for the following frozen EXPADIO concepts.

### Industry Pack

A versioned installable template describing an industry's default vocabulary, object types, personas, relationships, workflows, lifecycle definitions, policies and module recommendations.

Industry is configuration, not an application mode.

### Business ontology

Neutral semantic object definitions independent of labels. Examples:

- PERSON
- ORGANIZATION
- CLIENT
- PROVIDER
- PROFESSIONAL
- OPERATOR
- ASSET
- SERVICE
- CASE

Vertical packs extend these with domain object types without changing universal core semantics.

### Terminology

Display vocabulary mapped to semantic keys.

Examples:

- `PROVIDER` -> Dentist in DENTEX
- `CLIENT` -> Patient in DENTEX
- `PROFESSIONAL` -> Realtor/Broker in real estate
- `OPERATOR` -> Driver in logistics

Authorization and workflow rules must reference semantic identifiers, never editable labels.

### Persona

Business identity/archetype independent of permissions.

Examples: provider, professional, customer, operator, applicant, partner.

### Functional role

Responsibility/authority separate from persona and relationship. Existing authorization roles may be reused as enforcement machinery, but Business Configuration must own the business-facing role definition and mapping boundary.

### Relationship type

First-class typed relationship between people, organizations and business objects.

Examples:

- PROVIDER_OF
- PATIENT_OF
- AGENT_OF
- DRIVER_OF
- EMPLOYED_BY
- MANAGES

Relationships may become authorization and assignment attributes but are not permissions themselves.

### Team and queue

Named operational grouping and work queue primitives for assignment targets.

### Skills and certifications

Versioned eligibility facts used by assignment/workflow policies. LMS may issue certifications; Business Configuration defines what certifications/skills mean to operations.

### Lifecycle definition

Reusable, versioned state-machine definitions for business objects. Workflow orchestrates state transitions but should not require vertical states to be compiled into the universal engine.

### Policy definition

Business constraints beyond raw permission, for example:

- approval threshold
- territory boundary
- relationship requirement
- certification requirement
- separation of duties
- jurisdiction constraint

### Configuration versioning

Effective-dated, auditable immutable versions with publish/supersede semantics and rollback to a prior published version through a new effective version.

## 5. Separation rules

The following distinctions are mandatory:

```text
Persona          != Role
Role             != Relationship
Relationship     != Permission
Permission       != Policy
Label            != Semantic key
Lifecycle        != Workflow
Industry Pack    != Vertical application
Skill            != Certification
Team             != Queue
```

## 6. Workflow integration

Workflow participants should resolve through neutral target types:

- USER/SUBJECT
- ROLE
- PERSONA
- TEAM
- QUEUE
- ORGANIZATION
- TERRITORY
- RELATIONSHIP
- EXTERNAL_PARTY
- SYSTEM
- AI_AGENT

Business Configuration defines these target semantics. The workflow engine executes them.

## 7. Authorization integration

EXPADIO authorization remains canonical and consumes Business Configuration as attributes/context.

Target decision context remains:

```text
Identity
+ Tenant/Organization
+ Persona
+ Functional Role
+ Relationship
+ Scope/Territory
+ Resource
+ Policy
+ Entitlement
+ Delegation
+ Workflow Context
```

Editable terminology must never enter authorization decisions.

## 8. Industry Pack inheritance

Initial target inheritance:

```text
EXPADIO DEFAULT
    ↓
INDUSTRY PACK
    ↓
BUSINESS TEMPLATE
    ↓
TENANT / BRAND
    ↓
ORGANIZATION / BUSINESS UNIT
```

Jurisdiction and territory should usually act as policy overlays rather than blindly outranking organizational configuration for every setting.

## 9. Initial implementation slices

### E1 — semantic key + terminology contracts

Define stable semantic identifiers, terminology entries and versioned terminology packs.

### E2 — Industry Pack contract

Define versioned industry packs and declared included capabilities.

### E3 — persona / functional role / relationship contracts

Keep each primitive separate even when UI onboarding presents them together.

### E4 — team / queue / skill / certification contracts

Define workflow-assignment eligibility primitives.

### E5 — lifecycle definition

Versioned generic state machine contract, without a vertical state catalogue in core.

### E6 — effective configuration resolver

Replace BEMP's in-memory three-level resolver with explicit inheritance, effective dates and provenance.

### E7 — persistence + RLS

Persist definitions/versions/tenant overlays after contracts and resolver invariants are stable.

### E8 — onboarding projection

Expose an onboarding model built from these primitives rather than storing onboarding answers as an unrelated second configuration system.

## 10. Migration decision

| Existing BEMP concept | EXPADIO decision |
|---|---|
| Generic ConfigurationValue | ADAPT |
| Platform default settings | ADAPT |
| Brand override | GENERALIZE to tenant/org scopes |
| Jurisdiction override | RETAIN as policy/config overlay with declared precedence |
| Resolved source | EXPAND to full provenance trace |
| Industry Pack | NEW CORE PRIMITIVE |
| Ontology | NEW CORE PRIMITIVE |
| Terminology | NEW CORE PRIMITIVE |
| Persona | NEW CORE PRIMITIVE |
| Functional business role | NORMALIZE over authorization machinery |
| Relationship | NEW CORE PRIMITIVE |
| Team / Queue | NEW CORE PRIMITIVES |
| Skills / Certifications | NEW CORE PRIMITIVES |
| Lifecycle definition | NEW CORE PRIMITIVE |
| Effective-dated configuration versions | NEW CORE PRIMITIVE |

## 11. Core principle

> EXPADIO provides the grammar of business. Industry Packs provide the vocabulary and defaults. Tenants configure the vocabulary and operating rules. BEMP/EXPADIO Core executes the resulting business deterministically.
