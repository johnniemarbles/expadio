# EXPADIO Repository Extraction Matrix

**Status:** Verified extraction baseline — 2026-08-24

This matrix records what has actually been verified in source repositories. A repository is not promoted merely because it contains a folder, route, UI or design document with the name of a desired capability.

## Classification rules

- **KEEP AS CORE** — capability belongs in BEMP/EXPADIO core.
- **PROMOTE SEMANTICS/PATTERNS** — preserve superior contracts, invariants or tests inside an existing EXPADIO core boundary; do not create a parallel engine.
- **PROMOTE TO HORIZONTAL** — verified reusable implementation shared by multiple verticals.
- **VERTICALIZE** — domain-specific implementation remains outside core.
- **REFERENCE EXPERIENCE** — useful UX/product behavior, but not a verified reusable backend.
- **REFACTOR** — valuable capability, but architecture must be normalized before promotion.
- **RETIRE** — duplicate, obsolete or superseded implementation.
- **NO EXTRACTABLE CODE** — repository exists but no usable implementation is currently available.

## Verified source map

| Repository | Verified classification | Action |
|---|---|---|
| `BEMP` | **KEEP AS CORE + REFACTOR BOUNDARIES** | Primary source for tenancy, capability fabric, CRM/leads/cases, Decision Fabric, communication, events/outbox, AI runtime contracts and provider control-plane foundations. |
| `dentexnew` | **VERTICALIZE + PROMOTE SEMANTICS/PATTERNS** | Primary DENTEX vertical source. Current HEAD has real Postgres wiring and scoped DB contexts. Promote selected tenancy/public-context/directory/authorization patterns; keep dental domain vertical. |
| `dentex` | VERTICALIZE / REFERENCE | Compare against `dentexnew`; preserve only unique superior behavior. |
| `dentexpro` | RETIRE / REFERENCE | Review only for unique capability not present in the primary DENTEX source. |
| `dentexpro001` | RETIRE | Empty repository. |
| `Dentexlite` | RETIRE / REFERENCE | Historical/UX reference only unless a unique capability is proven. |
| `DENTEXPROMAX` | RETIRE / REFERENCE | Historical/UX reference only unless a unique capability is proven. |
| `Dentex-V3.0` | RETIRE / REFERENCE | Historical/UX reference only unless a unique capability is proven. |
| `dentex-rbac` | PROMOTE SEMANTICS/PATTERNS / REFACTOR | Compare authorization semantics with BEMP/GFSM; never become a separate EXPADIO authorization engine. |
| `Patient-Dashboard-` | REFERENCE EXPERIENCE | Extract client/patient UX patterns through EXPADIO APIs; do not duplicate backend ownership. |
| `gfsm` | **PROMOTE SEMANTICS/PATTERNS** | Import authorization, gate, SLA-clock, audit-integrity and atomic-config invariants/tests into canonical EXPADIO packages. Do not migrate GFSM engines wholesale. |
| `lims-platform` | **VERTICALIZE + PROMOTE SEMANTICS/PATTERNS** | Source for `verticals/tpa-lims`; promote regulated RLS, ABAC, consent/audit, artifact-integrity and delivery-state patterns. |
| `tpa-and-lims-combo` | **NO EXTRACTABLE CODE / FUTURE VERTICAL** | Repository currently contains only a placeholder plan; no runtime to migrate. |
| `CLIENT-PORTAL` | PROMOTE EXPERIENCE / REFACTOR | Extract client experience and workflow interaction patterns; backend remains canonical EXPADIO. |
| `BrandExpansionManagementPlatform` | REFERENCE / PROMOTE PATTERNS | Extract only modular/platform-admin patterns superior to BEMP/EXPADIO. |
| `tress-lounge-platform` | REFERENCE / VERTICALIZE | Enterprise/franchise/LMS ideas may be audited separately; Tress domain remains vertical. |
| `Tress-Lounge` | VERTICAL REFERENCE | Historical/domain source only. |
| `TL15July` | VERTICAL REFERENCE | Historical/domain source only. |
| `TLounge` | VERTICAL REFERENCE | Historical/domain source only. |
| `outreach` | HORIZONTAL CANDIDATE — NOT YET VERIFIED | Audit engagement/outreach capabilities before promotion into CRM/communication. |
| `expadio` | **TARGET MASTER** | Canonical architecture and eventual codebase. |
| `werealtors` | NOT VERIFIED / NOT FOUND IN CURRENT AUDIT | Add only after repository/source is identified. |
| `nordrux` | NOT VERIFIED / NOT FOUND IN CURRENT AUDIT | Add only after repository/source is identified. |

## Canonical source hierarchy

Where repositories overlap, use this precedence unless a verified exception is documented:

```text
BEMP
  -> EXPADIO canonical core engines

GFSM
  -> invariants + tests that harden canonical authorization/workflow/audit/config

LIMS
  -> regulated-system invariants + tests + TPA/LIMS vertical

DENTEX
  -> DENTEX vertical + selected generic patterns/experiences
```

The purpose is convergence, not accumulation of parallel engines.

# BEMP extraction targets

## Promote to EXPADIO core

- tenant / organization context
- identity-context adapters
- capability registry and capability state
- tenant capability bindings and modes
- connector/provider registry
- provider proofs / readiness / external account grants
- CRM / people / organizations
- leads / demand
- cases
- agreements
- Decision Fabric / workflow
- resolver/provenance
- assignment / authority / SoD foundation
- entitlements
- communication
- conversations
- AI communication-agent runtime
- voice-agent integration
- event/outbox foundation
- configuration/versioning foundation
- audit/provenance foundation

## Refactor before or during extraction

- generalized authorization contract
- industry-specific terminology
- hard-coded business assumptions
- direct infrastructure-provider imports
- AI provider calls outside gateway boundaries
- communication providers outside adapters
- storage abstraction
- credential/secrets boundary
- event contract normalization

## Canonical BEMP primitives

Two BEMP concepts are now frozen as EXPADIO foundations:

```text
CAPABILITY FABRIC
Capability -> Binding -> Connector -> Provider -> Proof -> State -> Entitlement/Scope

DECISION FABRIC
Context -> Classification -> Rules -> Authority -> Compliance -> Blueprint -> Workflow -> Provenance
```

Do not create competing implementations of either fabric.

# DENTEX extraction strategy

See `DENTEX-EXTRACTION-MAP.md`.

## Verified reusable patterns

- active organization/location execution context
- distinct read-only public execution context
- role restriction + delegation + break-glass concepts
- operation-level schemas/errors/context
- public listing separate from tenant-owned business object
- per-attribute provenance and retention
- claim/verification/revocation workflow
- deterministic, explainable, contestable scoring pattern
- AI extraction/triage separated from deterministic authority

## Keep vertical

- patients and clinical records
- dental providers/clinics
- appointments/treatment/prescriptions/recalls
- imaging
- dental insurance semantics
- lab cases
- PMS integration
- dental inventory semantics
- dental directory ontology/trust inputs

## Corrected horizontal-module claims

The audit did **not** verify DENTEX as the production source for the planned horizontal modules:

- `web-academy` is currently a client-side prototype with local/hard-coded course and quiz state, not a reusable LMS backend.
- `apps/jobs` is an operational/background job scheduler, not a recruiting/jobs-marketplace engine.
- no verified reusable community backend was found; `web-social` alone is insufficient.
- `web-market` is an experience surface; a mature generic marketplace core was not established by this audit.

Therefore `modules/lms`, `modules/community`, `modules/jobs` and `modules/marketplace` remain **open implementation targets** until a source with real persistence/domain contracts is verified or they are built directly in EXPADIO.

# GFSM extraction strategy

See `GFSM-EXTRACTION-MAP.md`.

Promote into existing EXPADIO boundaries:

| GFSM concept | EXPADIO target |
|---|---|
| action scope vs visibility scope | `packages/authorization` |
| capability -> scope -> state -> classification -> SoD pipeline | `packages/authorization` |
| field classification / compartments | `packages/authorization` |
| explainable denial stage/reason | `packages/authorization` |
| named transition criteria | `packages/workflow` |
| non-waivable invariants | `packages/workflow` |
| illegal-waiver detection | `packages/workflow` |
| reason-required transitions | `packages/workflow` |
| pause-aware SLA clocks | `packages/workflow` |
| deterministic audit hash-chain verifier | `packages/audit` |
| atomic dependent configuration changesets | `packages/business-config` |

Do not create a second gate engine, access resolver or audit store.

# LIMS / TPA extraction strategy

See `LIMS-TPA-EXTRACTION-MAP.md`.

## Promote semantics/tests into EXPADIO core

- forced RLS as DB backstop
- token-derived tenant context
- relationship/subject ABAC
- disclosure vs self-access policy distinction
- auditing of sensitive reads
- ports/adapters domain separation
- content-addressed write-once artifact model
- explicit distinction between tamper-evident and WORM/retention-locked guarantees
- retry/reject/unknown-delivery/reconciliation taxonomy
- partition coverage/health safeguards

## Keep vertical

- sample/accession lifecycle
- chain of custody
- specimen validity
- DOT program rules
- MRO
- AU680/ASTM
- MassHunter confirmation
- analytes/cutoffs
- Westgard QC
- laboratory auto-verification
- critical lab values
- laboratory reports
- laboratory HL7 semantics
- litigation packages

`lims-platform` explicitly reports AI as not built, so it is not an EXPADIO AI source.

`tpa-and-lims-combo` currently has no extractable implementation.

# Horizontal modules status

| Planned module | Current verified source | Status |
|---|---|---|
| LMS | none verified | OPEN — build or audit another source |
| Community | none verified | OPEN — build or audit another source |
| Jobs / recruiting | none verified | OPEN — DENTEX `apps/jobs` is not this capability |
| Marketplace | no mature reusable core verified | OPEN / reference UIs only |
| Directory / listings | strong DENTEX pattern, first vertical use | CANDIDATE — promote after second proven vertical reuse |
| Outreach / engagement | `outreach` candidate | AUDIT REQUIRED |

# Migration order

## P0 — Canonical core

1. BEMP boundary inventory and extraction contracts
2. IAM / tenancy / generalized authorization
3. Capability Fabric / provider control plane
4. Communication / conversation / provider adapters
5. Decision Fabric / resolver / authority / assignment
6. Business Configuration / ontology / terminology
7. Audit/provenance hardening
8. AI gateway / context / governance / voice / data orchestrator
9. Storage/provider integrity abstraction

## P0 hardening imports

While implementing P0, incorporate rather than postpone:

- GFSM visibility scope, classification, SoD-veto and explainable-denial tests
- GFSM invariant/waiver/reason/clock semantics into Decision Fabric
- GFSM audit-chain verification option
- GFSM atomic configuration changesets
- LIMS forced-RLS and subject-ABAC tests
- LIMS sensitive-read audit policy
- LIMS artifact-integrity capability levels
- LIMS ambiguous-delivery reconciliation semantics
- DENTEX active-context/public-context tests where they improve the canonical model

## P1 — Experiences and horizontals

10. Platform / Brand / Client / Public experiences
11. Verify or build LMS
12. Verify or build Community
13. Verify or build Jobs/recruiting
14. Verify or build Marketplace
15. Directory/listing module only if cross-vertical reuse is proven

## P1/P2 — Verticals

16. DENTEX vertical
17. TPA/LIMS vertical
18. WeRealtors / Nordrux / Insurance after source validation

# Quality gates

Every migrated capability must pass the applicable gates:

- TypeScript/Python compile or typecheck
- unit tests
- integration tests
- database migration tests
- tenant isolation tests
- authorization regression matrix
- SoD tests
- RLS bypass/cross-tenant tests
- provider-boundary tests
- event/outbox idempotency tests
- AI/agent tool authorization tests
- sensitive-read audit tests where required
- artifact integrity/retention capability tests
- end-to-end smoke evidence

# Safety rules

- Do not delete or destructively rewrite source repositories.
- Do not create a second workflow/Decision Fabric engine.
- Do not create a second capability/provider-control fabric.
- Do not create a second communication platform.
- Do not duplicate authentication/authorization per vertical.
- Do not label a UI prototype as a migrated backend capability.
- Do not treat tamper evidence as WORM/immutability.
- Preserve source repository, path, commit and test evidence for every migration.
- Every extracted capability must have an explicit EXPADIO owner boundary.
- A migration is complete only when equivalent EXPADIO tests pass.