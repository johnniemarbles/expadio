# EXPADIO Technical Blueprint

**Status:** Implementation baseline
**Date:** 2026-08-24

## 1. Objective

Turn the frozen EXPADIO architecture into an incremental implementation plan without duplicating BEMP, DENTEX, GFSM, LIMS or client-portal capabilities.

## 2. Canonical layering

```text
Experience
  -> Application APIs
    -> BEMP Domain/Core
      -> Policy / IAM / Tenancy
        -> Event + Data Orchestration
          -> Provider Gateways
            -> Infrastructure Providers
```

AI/voice is a platform capability beside the BEMP domain, not a replacement for deterministic business logic.

## 3. Initial monorepo boundary

Start with a small number of packages. Do not create a package for every concept until extraction proves the boundary is stable.

```text
apps/
  api/
  platform-web/
  brand-web/
  client-web/
  public-web/

packages/
  core-domain/
  iam/
  tenancy/
  authorization/
  business-config/
  crm/
  leads/
  cases/
  workflow/
  communication/
  ai/
  data-orchestrator/
  providers/
  storage/
  audit/
  ui/
  sdk/

modules/
  lms/
  community/
  jobs/
  marketplace/

verticals/
  dentex/
  werealtors/
  nordrux/
  insurance/
  tpa-lims/
```

These are target boundaries. Existing BEMP packages are the primary source and must be mapped before code is moved.

## 4. Provider strategy

Default candidates:

- Identity: Clerk
- Relational database: PostgreSQL, initially Supabase-managed where appropriate
- Object storage: S3-compatible abstraction, initially Supabase Storage where appropriate
- Hosting: Railway initially
- Edge/security: Cloudflare
- AI/voice/communications: provider gateways with adapters

Provider SDKs must not leak into business modules.

## 5. AI/voice

AI Gateway capabilities:

- LLM generation
- embeddings
- vision
- extraction
- translation
- classification

Voice Gateway capabilities:

- telephony integration
- streaming audio
- speech-to-text
- text-to-speech
- conversation orchestration
- call recording/transcript metadata
- call intelligence

AI jobs must record provider, model, tenant, purpose, status, cost, latency, provenance and policy outcome.

## 6. Data orchestration

The Data & Intelligence Orchestrator consumes domain/provider events and coordinates:

```text
ingest -> normalize -> resolve identity -> extract -> validate -> enrich -> index -> trigger workflow -> audit
```

AI output is evidence/observation until deterministic validation and policy permit a state mutation.

## 7. Identity and authorization

Authentication provider is replaceable. EXPADIO authorization is canonical.

Every sensitive request resolves:

```text
identity + organization + persona + role + relationship + scope + resource + policy + entitlement
```

AI agents use the same authorization path and never receive unrestricted database access.

## 8. Migration rule

No source repository is rewritten destructively. Each extracted capability must have:

- source repository
- source path/module
- target EXPADIO boundary
- dependencies
- data migration requirements
- tests/evidence
- rollback strategy

## 9. First implementation sequence

### P0-A — Core boundary inventory
Map BEMP controllers, services, modules, packages, database schemas and provider dependencies.

### P0-B — IAM/tenancy/authorization
Normalize identity context, tenant/organization scope and authorization contracts.

### P0-C — Communication
Promote existing BEMP communication contracts behind provider interfaces. Preserve existing safety/retry/webhook/readiness tests.

### P0-D — Workflow/Decision Fabric
Make the existing BEMP Decision Fabric canonical. Do not create another workflow engine.

### P0-E — Business Configuration
Introduce industry, ontology, terminology, persona, role, relationship, team, skill, certification, policy and lifecycle configuration.

### P0-F — AI/data intelligence
Extract the existing AI runtime and add provider-neutral AI/voice/data orchestration boundaries.

### P1 — Horizontal modules
LMS, Community, Jobs and Marketplace.

### P1 — DENTEX
Extract only vertical ontology, workflows, domain objects, UI and integrations from the selected DENTEX source.

### P2 — Additional verticals
WeRealtors, Nordrux, Insurance and TPA/LIMS after their source repositories are validated.

## 10. Quality gates

Every migration must pass:

- TypeScript compile/check
- unit tests
- integration tests
- database migration checks
- provider boundary checks
- authorization tests
- tenant isolation tests
- AI/agent tool authorization tests where applicable
- end-to-end smoke evidence

## 11. Non-goals

Do not initially:

- rewrite BEMP wholesale
- introduce Kafka merely for architectural fashion
- create dozens of microservices
- make Firebase the canonical database
- make Supabase the application architecture
- make Clerk the authorization source of truth
- hard-code industry terminology into core
- allow verticals to fork core engines
