# Platform vs Brand Capability Ledger

Status: active repository source of truth  
Audit baseline: `main@d603c96` (2026-09-03)  
Ownership rule: shared/core owns domain truth; Platform governs; Brand operates.

This ledger reconciles planned capability with repository evidence. A merged contract or source-level guard is **partial** until its runtime behavior is covered by integration or end-to-end evidence.

| Capability | Shared/core | Platform | Brand | Current classification | Evidence on main | Next release gate |
|---|---|---|---|---|---|---|
| Communications | Delivery queue, provider abstraction, sender/suppression/template contracts | Provider, domain, credential, health and audit controls | Credential-blind sender, suppression, template and management workspace | Strong / operationally partial | PRs #600–#608; completion checklist communication lifecycle | Prove tenant-bound COMMUNICATE delivery end-to-end before enabling social dispatch |
| CRM Leads | `@expadio/lead`, five-stage CRM entity, organization-bound persistence | Governance/support CRM APIs | Entitled operating workspace, filters and customer conversion | Current | PR #604 organization scope; PR #612 Brand module | Harden transitions with legal graph, reason, revision and audit evidence |
| Demand Capture | Trusted persisted capture, capture-to-CRM projection, signed source ingress | Source governance and audit seam | Capture-source registration and scoped operations | Partial | PR #614 trusted persistence; PR #623 signed ingress | Port routing/scoring/assignment engines; explained unassigned queue; full journey UI |
| Organization authorization | Canonical organization graph and RLS context | Policy and support visibility | Selected-workspace descendant visibility | Current for Leads; not globally attested | PR #604; real PostgreSQL Lead RLS tests | Apply the same subtree release gate to every Brand operational module |
| Product entitlement | Product-module catalogue and activation runtime | Catalogue/entitlement/activation governance | Module shown only when available, entitled and active | Current for Lead Management | PR #612 and activation integration test | Extend consistent activation tests to each Brand module |
| Decision Fabric | Governed work types, separation of duties and decisions | Policy/reviewer configuration | Business review actions where granted | Strong foundation / uneven adoption | platform checklist and domain integrations | Use for policy-selected transitions; never auto-approve from scores |
| Action/Event Fabric | Domain events, outbox, scheduler and core executors | Health, trace and operational control | Consumes governed outcomes | Strong foundation / recovery incomplete | completion checklist execution spine | Deliver governed recovery commands and recovery console |
| AutoGTM | Sequence/campaign models and communication intents | Demand-generation control plane | No complete Brand operating surface evidenced | Partial | checklist #483 slice | Seed-tenant proofs and real COMMUNICATE intent; keep connector dark until BYOC |
| Social Content | Connector contract and disabled LinkedIn adapter | Provider governance only | No live publish operation | Intentionally gated | ADR-007 / PR #491 | Prove email COMMUNICATE path, BYOC lease and provider evidence before enablement |
| Learning | Shared learning domain and completion reconciliation | Governance/admin services | Admin workflows, assessments, learner programs and credentials | Substantial / needs consolidated E2E audit | PRs #615, #617–#619 | Run role-bound end-to-end completion and credential issuance matrix |
| Motion system | Shared semantic tokens and primitives | Token-governed adoption | Workspace-shell adoption | Current | motion commits `c284387`, `aa72e05`, `29ec907`, `961995f` | Continue ratchet tests; no local ad-hoc motion systems |
| Knowledge / AI / Agents / Voice | Planned horizontal foundations | Planned policy consoles | No operational surfaces expected yet | Absent / planned | platform checklist | Implement in frozen strategy order after P0/P1 hardening |

## Lead Management gate reconciliation

The August 31 checklist predates the latest merged slices. Current evidence is:

| Original gate | Status at baseline | Evidence / limitation |
|---|---|---|
| FORCE RLS across tenants and organization descendants | Implemented and integration-tested | PR #604 adds immutable `organization_id`, descendant RLS, and a real PostgreSQL test. Production-data soak remains an operational deployment check, not a code claim. |
| Idempotent capture-to-CRM projection with history retained | Implemented and integration-tested | PR #614 loads persisted capture state, projects once, and retains capture provenance. |
| Trusted gateway/source scope; no body-chosen authority | Implemented for signed ingress | PR #623 verifies registered signed sources and rejects authority-bearing input. |
| No copied BEMP Brand Lead implementation | Pass | Brand consumes EXPADIO shared contracts and organization-scoped services; no BEMP route/service copy is used. |

## Current execution order

1. Keep this ledger and the completion checklist updated in every capability PR.
2. Complete Demand Capture routing, scoring explanation, assignment and the explained unassigned queue.
3. Harden CRM stage transitions with revision, actor, reason and audit evidence.
4. Finish Brand Communications campaigns, conversations and tenant-safe reporting.
5. Complete P0 governed recovery and P1 capability-level authorization.
6. Audit the remaining domains with the same shared/core → Platform governance → Brand operations rubric.

## Release discipline

- Do not call source-contract tests runtime proof.
- Do not treat catalogue registration as entitlement.
- Do not use free-text provenance as authorization.
- Do not expose a Brand operational module without descendant-scope evidence.
- Do not duplicate shared domain logic between Platform and Brand.
- Keep capture-to-CRM conversion distinct from CRM-lead-to-customer conversion.
