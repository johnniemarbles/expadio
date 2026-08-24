# EXPADIO Repository Extraction Matrix

**Status:** Initial baseline from repository inventory and architecture review

## Classification rules

- **KEEP AS CORE** — capability belongs in BEMP/EXPADIO core.
- **PROMOTE TO HORIZONTAL** — reusable module shared by multiple verticals.
- **VERTICALIZE** — domain-specific implementation remains outside core.
- **REFACTOR** — valuable capability, but architecture must be normalized before promotion.
- **RETIRE** — duplicate, obsolete or superseded implementation.

## Current source map

| Repository | Initial classification | Action |
|---|---|---|
| `BEMP` | KEEP AS CORE | Extract/normalize existing core engines into EXPADIO boundaries. |
| `dentexnew` | VERTICALIZE + PROMOTE selected horizontal patterns | Use as primary DENTEX architecture/domain source; do not copy dental vocabulary into core. |
| `dentex` | VERTICALIZE / REFERENCE | Compare against dentexnew and preserve only superior capabilities. |
| `dentexpro` | RETIRE / REFERENCE | Review for unique functionality; avoid another DENTEX fork. |
| `dentexpro001` | RETIRE | Empty repository. |
| `Dentexlite` | RETIRE / REFERENCE | Review only for unique UX/domain features. |
| `DENTEXPROMAX` | RETIRE / REFERENCE | Review only for unique UX/domain features. |
| `Dentex-V3.0` | RETIRE / REFERENCE | Review only for unique UX/domain features. |
| `dentex-rbac` | REFACTOR / PROMOTE | Compare authorization patterns with BEMP IAM/ABAC/ReBAC model. |
| `Patient-Dashboard-` | PROMOTE TO HORIZONTAL / REFERENCE | Extract client/patient experience patterns; use EXPADIO APIs. |
| `gfsm` | PROMOTE TO HORIZONTAL / REFACTOR | Extract governance, security and audit primitives. |
| `lims-platform` | VERTICALIZE + REFERENCE | Preserve regulated-data, RLS, consent, audit and compliance patterns; do not import LIMS domain into core. |
| `tpa-and-lims-combo` | FUTURE VERTICAL | Empty repository; no implementation to extract yet. |
| `CLIENT-PORTAL` | PROMOTE EXPERIENCE / REFACTOR | Extract client portal UX and workflow concepts; do not duplicate backend. |
| `BrandExpansionManagementPlatform` | REFERENCE / PROMOTE PATTERNS | Extract modular/Turborepo and platform-admin patterns where superior. |
| `tress-lounge-platform` | REFERENCE / PROMOTE PATTERNS | Extract franchise, LMS, governance and enterprise patterns; keep Tress domain vertical. |
| `Tress-Lounge` | VERTICAL REFERENCE | Historical/domain source only. |
| `TL15July` | VERTICAL REFERENCE | Historical/domain source only. |
| `TLounge` | VERTICAL REFERENCE | Historical/domain source only. |
| `outreach` | PROMOTE TO HORIZONTAL candidate | Audit outreach/engagement capabilities for CRM/communication integration. |
| `expadio` | TARGET MASTER | Build EXPADIO architecture and eventual canonical codebase here. |
| `werealtors` | NOT FOUND | Add when repository becomes available. |
| `nordrux` | NOT FOUND | Add when repository becomes available. |

## BEMP extraction targets

BEMP already has a Turborepo-style workspace (`apps/*`, `packages/*`) and scripts for core, spatial, web and AI runtime. It also contains communication tests and database/workflow seed operations. These are strong candidates for the first extraction wave.

### Promote to EXPADIO core

- tenancy / organization context
- IAM authorization contracts
- CRM / people / organizations
- leads / demand
- cases
- agreements
- workflow
- Decision Fabric
- assignment
- entitlements
- communication
- compliance primitives
- configuration/versioning
- audit/provenance
- AI runtime interfaces

### Refactor before extraction

- industry-specific terminology
- hard-coded business assumptions
- direct infrastructure-provider dependencies
- authorization logic duplicated across modules
- AI provider calls outside gateway boundaries
- communication provider calls outside communication gateway

## DENTEX extraction strategy

`dentexnew` should be treated as the primary current DENTEX vertical candidate because it demonstrates the desired multi-application/Turborepo direction.

Extract into EXPADIO only if a capability is genuinely horizontal, such as:

- LMS infrastructure
- community primitives
- jobs infrastructure
- shared scheduling primitives
- generic marketplace primitives
- reusable professional profile patterns

Keep dental-specific objects and terminology under `verticals/dentex`.

## GFSM / LIMS extraction strategy

Use GFSM and LIMS as **architecture references**, not as competing cores.

Promote patterns for:

- tenant isolation
- RLS
- ABAC
- auditability
- consent
- data classification
- regulated retention
- immutable artifacts
- event/outbox processing
- security evidence

## Migration order

1. EXPADIO architecture and provider contracts
2. BEMP core boundaries
3. IAM / tenancy / authorization normalization
4. Communication gateway
5. Workflow / Decision Fabric / Assignment
6. Business Configuration / Ontology / Terminology
7. AI Gateway / Voice / Data Orchestrator
8. Horizontal modules (LMS, Community, Jobs, Marketplace)
9. DENTEX vertical extraction
10. Other verticals as repositories become available

## Safety rules

- Do not delete or rewrite source repositories during extraction.
- Do not create a second workflow engine.
- Do not create a second communication platform.
- Do not duplicate authentication/authorization per vertical.
- Preserve source commit/PR traceability for migrated capabilities.
- Every migrated capability gets a target EXPADIO package/module and a source reference.
- CI must validate build, typecheck, tests and integration contracts before a migration is considered complete.
