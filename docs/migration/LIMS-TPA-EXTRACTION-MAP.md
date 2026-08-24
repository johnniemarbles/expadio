# LIMS / TPA Extraction Map

**Status:** Verified source audit baseline  
**Primary implemented source:** `johnniemarbles/lims-platform`  
**TPA combination source:** `johnniemarbles/tpa-and-lims-combo`  
**Target:** `verticals/tpa-lims` + regulated-system patterns promoted into EXPADIO core

## Executive decision

`lims-platform` is a substantial regulated-domain reference implementation with strong isolation, audit, persistence and workflow safety patterns. It is **not** a replacement for BEMP/EXPADIO core.

The laboratory, toxicology, DOT, MRO, analyzer and result-processing logic belongs in `verticals/tpa-lims`.

The core value to promote is the set of **regulatory engineering patterns and tests**:

- forced tenant RLS
- token-derived tenant context
- ABAC subject scoping
- consent-aware disclosure
- audited PHI reads
- ports/adapters separation
- write-once/content-addressed artifacts
- explicit distinction between tamper-evident and immutable storage
- reliable outbound delivery state machines
- partition maintenance and isolation testing

The `tpa-and-lims-combo` repository currently contains no extractable implementation; only a placeholder plan file is present. It is therefore a future vertical source, not a current code source.

## Verified LIMS implementation

The repository currently includes implemented services for:

- instrument gateway / ASTM ingestion
- MassHunter confirmation file handling
- MRO review
- PHIPA compliance
- authentication verification and authorization
- API domain ports
- HL7 outbound
- result corrections
- confirmation forensics
- reflex testing
- specimen validity
- critical callbacks
- auto-verification
- reports
- Westgard QC
- Postgres persistence
- composition/server workers

The repository also contains Postgres migrations, forced RLS, integration tests and a durable Postgres execution path.

The source explicitly states that the overall product is not production-ready and that identity issuance/login/MFA, deployment infrastructure and some interoperability remain outside the implementation. EXPADIO must preserve that distinction rather than treating a passing domain suite as proof of deployment readiness.

## Promote into EXPADIO core as patterns/contracts

### 1. Forced RLS as a backstop

The strongest reusable lesson is defence in depth:

```text
verified identity/context
  -> application authorization
  -> scoped repository/adapter
  -> database RLS backstop
```

EXPADIO should retain application-level authorization as canonical while using RLS to make accidental unscoped access fail closed for tenant-controlled data.

Target: `packages/tenancy`, persistence infrastructure and tenant-isolation test suites.

### 2. ABAC for subject-bound access

LIMS proves a useful pattern where the same role may access only records related to a signed subject attribute, e.g. employer, patient or ordering-provider identity.

Promote the generic idea:

```text
role/capability
+ relationship/subject attribute
+ resource scope
+ state/release status
+ policy
= access decision
```

Target: `packages/authorization`.

Do not copy LIMS role names into core.

### 3. Consent and self-access are separate policy concepts

A particularly important semantic distinction in LIMS is that consent governs disclosure to others, while a person's own lawful access can follow a separate policy path.

Promote the policy capability, not the PHIPA-specific rule:

- disclosure policy
- self-access policy
- relationship policy
- jurisdictional override
- purpose/basis of access
- audit requirements

Target: `packages/authorization` + `packages/business-config`/policy definitions.

### 4. Every sensitive read is an auditable event

LIMS treats reads—not just writes—as security-relevant events.

Promote:

- sensitive-read event taxonomy
- actor, subject, purpose, resource and decision context
- denial logging where policy requires it
- retention category

Target: `packages/audit`.

### 5. Content-addressed write-once artifact contract

LIMS stores some issued/raw artifacts by server-computed SHA-256 and restricts mutation. The implementation documentation correctly warns that a database trigger is **not equivalent to storage-provider object lock**.

Promote this distinction into EXPADIO storage contracts:

```text
APPEND_ONLY / WRITE_ONCE
TAMPER_EVIDENT
RETENTION_LOCKED / WORM
```

These must be separate guarantees.

Target: `packages/storage` + provider capability/proof model.

The capability fabric should be able to express whether a chosen provider actually satisfies a required immutability/retention proof.

### 6. Ports/adapters boundary

The LIMS status document identifies the ports/adapters separation—not its reference HTTP server—as the reusable architecture.

Promote:

- pure domain rules
- provider/persistence ports
- infrastructure adapters
- composition root ownership

Do not promote the stdlib HTTP server as EXPADIO infrastructure.

### 7. Reliable outbound delivery taxonomy

The HL7 implementation contains an important generic integration rule:

- clear transport failure: retry
- explicit deterministic rejection: dead-letter, do not blindly retry
- ambiguous delivery/no acknowledgement: reconciliation state, avoid automatic duplicate creation

Promote a generic delivery outcome model into event/integration infrastructure:

```text
DELIVERED
RETRYABLE_FAILURE
REJECTED
UNKNOWN_DELIVERY
DEAD_LETTERED
RECONCILIATION_REQUIRED
```

Target: `packages/data-orchestrator` / provider delivery contracts and BEMP outbox evolution.

### 8. Partition health and maintenance as an operational invariant

The LIMS work discovered a subtle Postgres failure mode: default partition rows can block later creation of the intended bounded partition.

Promote operational tests and health signals where EXPADIO uses high-volume partitioned audit/event tables:

- future partition coverage
- historical/backfill coverage
- default-partition row alarms
- safe adoption/migration of default rows

Target: database operations, not a business module.

## Verticalize under `verticals/tpa-lims`

Keep the following vertical:

- accessioning
- specimen lifecycle and chain of custody
- urine/oral-fluid validity
- workplace testing programs
- DOT rules
- MRO review and split-specimen rules
- AU680 ASTM communication
- MassHunter confirmation
- analytes and cutoffs
- Westgard laboratory QC
- laboratory auto-verification rules
- critical laboratory values
- laboratory reports
- HL7 laboratory result semantics
- litigation package contents
- employer DER workflow

These may use EXPADIO common engines but their ontology and rules remain vertical.

## AI conclusion

The audited LIMS source does **not** contain a built AI layer. Its implementation-status document marks AI as not built.

Therefore:

- do not use LIMS as the source for EXPADIO AI runtime
- later connect `verticals/tpa-lims` to the shared EXPADIO AI/data-intelligence layer
- AI output in regulated workflows must remain evidence/proposal until deterministic validation and policy allow mutation

## TPA combination repository

`tpa-and-lims-combo` is not an implementation source at this time. The repository contains a `plans/` directory and a placeholder markdown file, but no usable TPA/LIMS runtime to extract.

Classification: **FUTURE VERTICAL / NO EXTRACTABLE CODE**.

## Extraction sequence

1. Build/normalize EXPADIO IAM, tenancy, authorization and audit first.
2. Add storage integrity/immutability capability contracts.
3. Preserve BEMP outbox as the event foundation; incorporate LIMS delivery-state semantics.
4. Create `verticals/tpa-lims` and migrate pure domain rules behind EXPADIO ports.
5. Map LIMS tenancy to canonical EXPADIO organization/context identifiers.
6. Recreate/port RLS and cross-tenant isolation tests against the EXPADIO schema.
7. Reuse EXPADIO Decision Fabric for human review/approval orchestration where compatible; do not fork the workflow engine.
8. Add provider adapters for instruments/HL7 as vertical connectors through the common provider boundary.

## Migration safety

No LIMS capability is considered migrated until tests prove:

- cross-tenant denial at application and DB layers
- correct subject/relationship scoping
- audit of sensitive reads
- deterministic release gates
- no automatic duplicate creation after ambiguous outbound delivery
- preserved raw/issued artifact integrity metadata
- correct retention/immutability capability state

Do not market database append-only controls as WORM unless the configured provider supplies and proves a true retention-lock guarantee.