# ADR-017: Lead Management as a Governed Business-Opportunity Engine

## Status
**Accepted — 2026-09-03**

## Context

The current Lead Management implementation is approximately 70% complete at the engine and backend level but only 30–35% complete as a commercially usable no-code product. The technical primitives are correct: capture storage with append-only submissions, RLS at tenant/organization scope, a scoring and qualification engine, routing and assignment, stage lifecycle governance, workflow blueprints, and consent/attribution persistence. These capabilities work in isolation.

The problem is compositional. There is no control-plane aggregate that connects them. Two concrete symptoms illustrate the gap:

**`layerKey` is a free-form string.** A capture source currently accepts any `layerKey` and becomes `ACTIVE` immediately. Nothing resolves that key through a governed catalog to derive which schema, qualification profile, workflow blueprint, evidence requirements, or routing policy should apply. The string carries implicit behavioral meaning that has no authoritative definition.

**There is no configuration inheritance model.** An organization hierarchy exists, and RLS enforces tenant/organization scope. But there is no mechanism by which Brand HQ sets a policy that Country can partially override, Region refines further, and a Unit operates within — with each layer's permitted overrides declared and enforced rather than assumed.

The result is that interest types (Franchise, Distribution, Affiliate, License, Agency) function as separate engineering concerns rather than as configuration over one governed engine. Adding a new interest type currently requires code changes. The system is not yet an engine; it is a collection of correctly implemented primitives waiting to be composed.

The scope of missing work is therefore primarily **configuration governance and product wiring**, not infrastructure. The next major milestone is not more Lead APIs. It is: Configuration → Hosted Form → Governed Lifecycle — the shortest path from capable infrastructure to something a Brand can operate without engineering involvement.

This ADR freezes the four architectural invariants that must hold across all future Lead Management implementation, and the policies that govern configuration state transitions.

---

## Decision

### Invariant 1: Business behavior resolves only from versioned governed configuration

No business behavior — schema selection, qualification profile, workflow blueprint, evidence requirements, routing policy, consent policy — may be inferred from a free-form string such as a `layerKey`, `sourceKey`, campaign name, UI route, or URL parameter.

Every behavioral resolution must flow through:

```
interestType + opportunityType
        ↓
InterestTypeRegistry (versioned, governed)
        ↓
{ schemaKey, qualificationProfileKey, workflowBlueprintKey,
  evidenceProfileKey, defaultRoutingProfileKey,
  supportedPublicationModes }
        ↓
effective LeadManagementConfiguration (resolved, published)
        ↓
behavior
```

`layerKey` is retained as immutable provenance metadata on existing records for backward compatibility. It is not the source of truth for any current or future behavioral decision.

### Invariant 2: Child organizations may not become effective through timeout alone

A configuration change that requires parent approval enters `PENDING_PARENT_REVIEW`. It does not become effective through inaction. Timeout escalates the decision to the next authorized ancestor; it does not lower the approval standard or substitute for explicit authorization.

Escalation changes the decision owner — it does not change what the decision requires.

The full state machine for governed configuration:

```
DRAFT
  ↓ submit for review
PENDING_PARENT_REVIEW
  ↓ review SLA expires (no action)
ESCALATED
  ↓ next authorized ancestor explicitly approves
APPROVED
  ↓ publish
PUBLISHED
```

If no authorized ancestor acts before the escalation chain is exhausted (top Brand governance boundary reached without resolution), the change enters `EXPIRED_UNRESOLVED`. It does not apply. Platform governance only enters the escalation chain where Platform policy explicitly requires it; ordinary Brand business configuration does not automatically escalate into Platform administration.

**Permitted child override types** (non-exhaustive; full catalog in LeadManagementConfiguration schema):

| Change type | Default approval requirement |
|---|---|
| Operational routing / SLA | Parent notification, self-publishes |
| Form labels, help text, ordering | Parent notification, self-publishes |
| Optional field addition | No approval required |
| Qualification threshold tightening | Parent notification within N days |
| New mandatory field addition | Explicit parent approval |
| Compliance / evidence requirement | Explicit parent approval; Platform audit |
| Interest type activation | Explicit parent approval |
| Mandatory platform field removal | Not permitted at any level |

Default SLA: 5 business days for governed changes; shorter periods configurable by Brand HQ within Platform limits. Brand HQ may not configure a timeout-to-approval policy.

### Invariant 3: Qualification facts retain immutable provenance; self-declared evidence is never represented as verified

Every row in `lead_qualifications` carries a non-nullable `evidence_source` column with no default. Any write path that omits `evidence_source` fails at the database constraint, not at application validation.

```ts
type QualificationEvidenceSource =
  | 'SELF_DECLARED'    // applicant-supplied at capture time
  | 'SYSTEM_DERIVED'   // calculated from other facts (e.g. scoring engine)
  | 'OPERATOR_ASSESSED'// human operator judgement
  | 'DOCUMENT_VERIFIED'// reviewed against submitted documents
  | 'EXTERNAL_VERIFIED';// verified against an external authoritative source
```

Subsequent verification never overwrites a prior qualification fact. It adds a new qualification fact with a stronger provenance. The scoring engine produces an initial score from all available facts, tagged by provenance, and a verified score once `DOCUMENT_VERIFIED` or `EXTERNAL_VERIFIED` facts exist.

The product surface must distinguish **Initial score** (may include self-declared facts) from **Verified score** (only stronger-provenance facts). A lead scoring `HOT` on self-declared $2M net worth must be visually distinguishable from one verified against bank statements.

Example progression:

```
Applicant submits: investmentBudget = $1.5M, liquidCapital = $600K
    ↓
lead_qualifications: criterion=financials, response=MEETS,
                     evidence_source=SELF_DECLARED
    ↓
initial_score = HOT (self-declared)
    ↓
Operator reviews bank statements
    ↓
lead_qualifications: criterion=financials, response=PARTIALLY_MEETS,
                     evidence_source=DOCUMENT_VERIFIED
    ↓
verified_score = WARM
```

The self-declared row is not deleted or modified. Both rows persist. The scoring engine uses the strongest available provenance per criterion for the current verified score, and the full provenance history for audit.

### Invariant 4: A Publication is distinct from a Capture Configuration and from a Capture Source

```
Capture Configuration (business rules, versioned, governed)
        ↓  one-to-many
Publication (a named channel deployment of a configuration version)
        ↓  one-to-many
Capture Source (the technical credential / provenance record)
```

One Capture Configuration may produce many Publications. Each Publication represents one independently attributable channel (website, Google Ads campaign, LinkedIn campaign, Franchise Expo QR code, broker referral landing page). Each Publication owns exactly one Capture Source. A Capture Source may not be shared across Publications.

This is what makes per-channel analytics separable:

```
Ontario Franchise v3
  ├─ Website /opportunity         → source_id: src_aaa  → 198 enquiries, 18 agreements
  ├─ Google Ads Canada           → source_id: src_bbb  → 312 enquiries, 11 agreements
  ├─ Meta Toronto                → source_id: src_ccc  → 428 enquiries, 11 agreements
  └─ LinkedIn campaign           → source_id: src_ddd  → 87 enquiries, 6 agreements
```

All four use the same business schema, qualification profile, workflow blueprint, and routing policy — derived from the same Capture Configuration — but produce independent attribution rows that can never be confused.

---

## Expiry / Escalation Policy

The escalation chain follows the organization hierarchy upward. Authorized ancestors are those with Brand governance roles at any ancestor organization node.

```
Unit submits change requiring parent approval
    ↓ 5 business days (default; configurable by Brand HQ)
ESCALATED to State / Region
    ↓ 3 business days (reduced SLA for escalated items)
ESCALATED to Country
    ↓ 3 business days
ESCALATED to Brand HQ
    ↓ 3 business days
EXPIRED_UNRESOLVED
```

`EXPIRED_UNRESOLVED` changes:
- Do not apply. The unit continues to operate on its currently published configuration.
- Are visible in the Brand HQ governance dashboard as unresolved items.
- May be resubmitted by the originating organization at any time.
- Are not automatically deleted or archived.

Platform governance enters the escalation chain only when:
- The change involves a Platform-defined mandatory compliance field.
- The configuration concerns a Platform-level capability (e.g., trust rail type, verification algorithm).
- Brand HQ has explicitly configured Platform escalation for a specific change category.

Brand HQ may configure shorter default SLAs. Brand HQ may not configure a policy that treats expiry as approval.

---

## Qualification Provenance Model

`evidence_source NOT NULL` is a DB-level constraint. The following rules are invariants, not conventions:

1. Capture-time Tier 2 self-declaration writes `evidence_source = 'SELF_DECLARED'`.
2. The scoring engine writes `evidence_source = 'SYSTEM_DERIVED'` for computed facts.
3. Operator assessment writes `evidence_source = 'OPERATOR_ASSESSED'`.
4. Document review writes `evidence_source = 'DOCUMENT_VERIFIED'`.
5. External verification writes `evidence_source = 'EXTERNAL_VERIFIED'`.
6. No existing row is updated. Each new fact is a new row.
7. The scoring engine accepts a `provenanceFilter` parameter. The current score uses the latest fact per criterion at or above a minimum provenance level. The full audit score uses all facts.
8. The product never presents a score derived from `SELF_DECLARED`-only facts as a verified score.

---

## Consequences

**What this ADR forecloses:**

- Using `layerKey`, `sourceKey`, campaign name, URL route, or any free-form string as a behavioral signal. All such strings become provenance metadata only.
- Auto-approval of governed configuration changes on timeout. Timeout escalates; escalation requires explicit action.
- Overwriting qualification history. Facts accumulate; they are not replaced.
- Sharing a Capture Source across Publications. One source, one publication, always.
- Removing or weakening Platform-defined mandatory compliance fields at any organizational level.

**Implementation order this ADR implies:**

```
ADR (this document)
 ↓
InterestTypeRegistry
 ↓
LeadManagementConfiguration (Platform defaults → Industry Pack → Brand HQ → child overrides)
 ↓
Hierarchical governance, delegation, approval, expiry/escalation
 ↓
Gate A: configuration governance proof
 ↓
Qualification provenance model + evidence_source NOT NULL migration + registry-driven seeding
 ↓
Evidence / compliance model
 ↓
Commercial Opportunity Industry Pack (Franchise, Master Franchise, Distribution, Affiliate, License, Agent)
 ↓
Hosted forms (apply.<brand>.com/opportunity — one neutral slug per brand)
 ↓
Gate B: lead lifecycle proof
 ↓
Publication Manager (Configuration → Publication → Capture Source)
 ↓
Gate C: provenance proof + Gate D: analytics partitioning proof
 ↓
SDK / embed / API / channel wrappers
 ↓
Complete Brand configuration workspace
 ↓
Final composed E2E acceptance gate
```

**The architecture principle this ADR establishes:**

EXPADIO Lead Management is one governed business-opportunity engine. Interest types are configuration, not product forks. Platform defines capabilities and invariants. Industry Packs provide domain defaults. Brand HQ configures business policy. Descendant organizations inherit and may strengthen or override only within delegated authority. Publications expose approved configuration to external channels without transferring scope authority to those channels.
