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
- **Mutation Boundary:** Read-only dashboard. Deep links to `/capabilities`, `/configuration/credentials`, `/workflows`, and `/governance`.

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
