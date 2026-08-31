# ADR-012: Shared tenant product modules and Learning activation

## Status

Proposed in draft PR — do not merge until the module lifecycle and Learning foundation are reviewed.

## Context

EXPADIO tenants such as DENTEX and WeRealtors need access to shared product modules according to commercial plan/contract. A tenant may be entitled to a module without choosing to activate it. Module activation may provision tenant-specific state and industry-pack-aware defaults.

The existing Capability Fabric is not the correct persistence model for installable product modules. Capability Fabric models governed execution/provider availability, including A/B/C/D modes and proof state. Product modules are a higher-level composition surface and may depend on capabilities without becoming capabilities themselves.

## Decision

Introduce a shared tenant product-module layer:

```text
platform product module
        ↓
commercial entitlement
        ↓
tenant activation
        ↓
idempotent provisioning
        ↓
active tenant module
        ↓
module-owned configuration
```

Learning is the first module registered on this layer.

### Separation of concerns

- `platform.product_modules` — platform-owned module catalogue and manifest.
- `platform.tenant_module_entitlements` — commercial entitlement edge. Tenant runtime may read it but cannot mint or mutate it.
- `platform.tenant_modules` — tenant opt-in/install state.
- `platform.learning_tenant_settings` — Learning-owned configuration.
- `platform.learning_academies` — provisioned tenant Academy state.

An entitlement does not activate a module. An active installation without a current entitlement is effectively suspended by the server-side access resolver. Data remains intact.

### Learning provisioner v1

Activation of `learning`:

1. resolves authenticated tenant context;
2. requires a tenant owner/admin or platform governing role;
3. verifies the platform module is enabled;
4. verifies a current commercial entitlement;
5. creates/reuses one tenant-module installation;
6. creates Learning tenant settings without overwriting existing tenant configuration;
7. creates one default Academy without duplication;
8. binds the Learning settings/Academy to the tenant's current `vertical_key` as provenance;
9. marks starter pack availability without copying content;
10. marks the module active;
11. appends `tenant.module.activated` using the existing domain-event + transactional-outbox spine.

Repeated activation after a successful commit returns the existing installation and Academy and emits no duplicate activation event.

### Entitlement source

This PR does not invent a billing/subscription engine. Entitlements record an authoritative source:

- `PLAN`
- `ADD_ON`
- `TRIAL`
- `CONTRACT`
- `PLATFORM_GRANT`

`source_key` identifies the upstream plan, add-on, trial, contract, or grant. A future commercial/billing control plane owns writes to this table.

### Industry packs

Learning is one shared engine. A tenant's `vertical_key` is captured as Learning provisioning provenance.

Examples:

```text
DENTEX tenant      -> Learning engine + dentex starter-pack availability
WeRealtors tenant  -> Learning engine + werealtors starter-pack availability
neutral tenant     -> Learning engine, no starter pack selected
```

This PR does not fork schema or runtime by vertical, and it does not install course content yet.

### Server-side enforcement

Navigation is not a security boundary. All Learning reads/writes must resolve effective module availability from:

```text
platform module enabled
+ current entitlement
+ tenant installation state
```

The first read proof is `GET /api/learning/context`.

## API proof

- `GET /api/tenant/modules` — tenant-scoped catalogue with entitlement, installation, and effective availability.
- `POST /api/tenant/modules/:key/activate` — governed activation. Learning is the first implemented provisioner.
- `GET /api/learning/context` — returns Academy/settings only when Learning is effectively active.

Responses carrying tenant state use `Cache-Control: private, no-store`.

## Security invariants

1. Tenant ID comes only from the authenticated EXPADIO request context.
2. Activation cannot create entitlement rows.
3. Entitlement rows are SELECT-only under tenant RLS.
4. Tenant module, Learning settings, and Academy tables use FORCE RLS.
5. Cross-tenant reads/writes are rejected at the database layer.
6. Lost entitlement prevents Learning access without deleting tenant Learning data.
7. Activation is idempotent across request replay.

## Deliberate non-goals

Not in this foundation PR:

- tenant Learning navigation/shell placement;
- course, lesson, content, assessment, enrollment, progress, certification, skills, SCORM/xAPI/LTI;
- starter content-pack installation;
- billing/subscription plan authoring;
- tenant self-upgrade;
- external learners or Learning commerce;
- AI tutor/authoring;
- automatic navigation registration before the final dual-shell contract is merged.

The UI is intentionally deferred so this PR does not repeat the nested-shell problem identified in the tenant product draft.

## Next slices after approval

1. Learning course/content/versioning domain.
2. Enrollment and progress.
3. Assessment/question bank.
4. Programs and certification/renewal.
5. Skills/competency evidence.
6. Module-driven tenant navigation in the accepted Brand/Tenant shell.
7. Starter-pack install modes: managed, cloned, extended.
