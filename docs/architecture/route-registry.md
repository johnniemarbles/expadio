# Platform Route Registry

**Status:** Implementation Baseline  
**Governing Standard:** ADR-282 (Descriptor-driven UX), D15 Part 0A (Capability re-parenting), N6/N7 Composed Views  
**Date:** 2026-08-27  

## Principles

1. **No Shadow Backends (N6):** Composed views consume data from existing owning domains without duplicating state or creating new configuration tables.
2. **Descriptor-Driven (N7):** Standard catalogue pages render from declarative descriptors. Complex cross-cutting dashboards use `HAND_BUILT` composed views.
3. **Deep Links for Mutations:** Mutating operations (e.g., rotating credentials, ratifying compliance packs, modifying workflows) deep-link directly to their respective canonical owning surfaces.
4. **Platform-Tier Neutrality:** Platform administration views aggregate cross-tenant telemetry without violating tenant isolation invariants or exposing un-entitled brand details.

---

## Route Entries

### 1. `/communications` — Communications Control Plane
- **Route:** `/communications`
- **Page Kind:** `HAND_BUILT` (Composed view; N7 exception)
- **Owner:** `experience-layer`
- **Promoted Rail Entry (N5):** `true` (Top-level shell navigation)
- **Reads From:**
  - `capability_registry`: Provider and connector infrastructure (`platform.connectors`, `platform.connector_capabilities` filtered by communication capabilities).
  - `comms_trigger_catalogue`: Registered triggers, locales, formats, and active/draft template counts (`platform.communication_templates`).
  - `comms_compliance_packs`: Central governance compliance packs and consent/suppression bounds (`platform.compliance_packs` / governance).
  - `comms_metrics`: 7-day cross-tenant deliverability aggregates, bounce/complaint rates, and connector performance (`platform.communication_deliveries`).
- **Mutation Boundary:** Composed control plane (no longer read-only). Performs governed mutations: provider registration via browser-side custody intake, connector enable/disable and provable revocation, template create/edit/version/publish/clone, sending-domain auto-configuration (Cloudflare) and DNS verification, and quota/spend-cap edits. All mutations resolve the request context, are authorization-gated, and are step-up-guarded where destructive. Also deep-links to `/capabilities`, `/configuration/credentials`, `/workflows`, and `/governance`.

### 1b. `/crm` — Universal Business Engine (CRM + Decision Fabric)
- **Route:** `/crm`
- **Page Kind:** `HAND_BUILT` (Composed view)
- **Owner:** `experience-layer`
- **Promoted Rail Entry (N5):** `true`
- **Reads From:**
  - `crm_accounts`: Tenant customer organizations (`platform.crm_accounts`, RLS-forced).
  - `crm_contacts`: People, optionally attached to an account (`platform.crm_contacts`, RLS-forced).
  - `crm_leads`: Sales pipeline over accounts (`platform.crm_leads`, RLS-forced) — stages `NEW → QUALIFIED → PROPOSAL → WON/LOST`.
  - `crm_cases`: Units of work (`platform.crm_cases`, RLS-forced) — carry the Decision Fabric seam (`blueprint_key`, `workflow_instance_id`, `stage_key`).
  - `crm_agreements`: Commitments with customers (`platform.crm_agreements`, RLS-forced) — status `DRAFT → ACTIVE → EXPIRED/CANCELLED`, with `source_lead_id` provenance.
  - `workflow_blueprints` / `workflow_instances` / `workflow_instance_transitions` / `workflow_stage_decisions` / `workflow_participant_assignments`: the governed workflow a case binds to (Decision Fabric).
- **Industry Packs (verticals as data):** Vocabulary is resolved server-side from the tenant's `tenants.vertical_key` (or a `?vertical=` preview) via `@expadio/industry-packs` (`GET`/`PATCH /api/tenancy/vertical`). Packs (e.g. DENTEX → Practices/Patients/Referrals/Treatments/Care plans) relabel display text only; canonical keys, authorization, RLS, and persisted data are unchanged.
- **API routes (all `resolveRequestContext`-scoped; reads require membership, writes a governing role):**
  - `POST/GET /api/crm/{accounts,contacts,leads,cases,agreements}` and `[id]` `PATCH` (stage/status/priority moves).
  - `POST /api/crm/leads/[id]/convert` — atomic conversion: won lead → CUSTOMER account (+ optional onboarding case).
  - **Case Decision Fabric** — `/api/crm/cases/[id]/workflow` (`GET` instance+stages+assignments, `POST` start+bind, `PATCH` advance under optimistic concurrency); `…/workflow/decision` (`POST` immutable stage decision); `…/workflow/participants` (`POST` assign a stage's required participant slot); `…/workflow/history` (`GET` the append-only transition + decision trace).
- **Governed transition gates (evaluated in the runtime before commit):** participant-assignment slots filled → recorded stage decision → **role + separation-of-duties** authority (approver holds a governing role and is not the maker; the authorizing role is recorded as decision evidence) → immutable append-only record → auto-complete at the terminal stage (`RUNNING → COMPLETED`). Instances are mutable under RLS; transitions and decisions are append-only/immutable (DB triggers).
- **Mutation Boundary:** All CRM and workflow mutations resolve the request context and are authorization-gated (tenant owner/admin or platform admin). Tenant isolation is enforced at the data layer via `platform.current_tenant_id()`; workflow decision authority is enforced additionally at the capture layer.

### 2. `/overview` — Command Center Overview
- **Route:** `/overview`
- **Page Kind:** `HAND_BUILT`
- **Owner:** `experience-layer`
- **Promoted Rail Entry (N5):** `true`
- **Reads From:**
  - `tenant_registry`: Organization and active scope context.
  - `capability_registry`: Active capability bindings and states.
  - `company_brain`: Unreviewed correction proposal counts.
  - `agent_runtime`: Total recorded agent runs.

### 3. `/capabilities` — Capabilities Index
- **Route:** `/capabilities`
- **Page Kind:** `CATALOGUE_PAGE`
- **Owner:** `capability-fabric`
- **Promoted Rail Entry (N5):** `true`
- **Reads From:**
  - `capability_registry`: Platform capabilities, tenant bindings, and capability states.

### 4. `/governance` — Governance Center
- **Route:** `/governance`
- **Page Kind:** `CATALOGUE_PAGE`
- **Owner:** `governance-fabric`
- **Promoted Rail Entry (N5):** `true`
- **Reads From:**
  - `authorization_policy`: Review queue and authorization decision records.

### 5. `/brain` — Company Brain
- **Route:** `/brain`
- **Page Kind:** `HAND_BUILT`
- **Owner:** `company-brain`
- **Promoted Rail Entry (N5):** `true`
- **Reads From:**
  - `knowledge_index`: Document index, provenance audit logs, and correction proposals.

### 6. `/configuration/credentials` — Credential Rotation & Vault
- **Route:** `/configuration/credentials`
- **Page Kind:** `HAND_BUILT`
- **Owner:** `secrets-fabric`
- **Promoted Rail Entry (N5):** `false` (Sub-navigation under configuration)
- **Reads From:**
  - `credential_registry`: Staged and committed rotation events (`platform.credential_rotation_events`).
