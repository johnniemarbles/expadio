# ADR-016: Tenant-private Brand Brain evidence ledger

## Decision

EXPADIO provides one neutral Brand Brain substrate for every tenant. It records observations from calls, conversations, decisions, tasks, movements, outcomes, documents, and corrections; attaches tamper-evident evidence references; and stores model/versioned insights as governed projections.

The ledger is tenant- and organization-scoped with forced PostgreSQL RLS. An idempotency key prevents duplicate ingestion. Insights carry confidence, model provenance, evidence IDs, review state, and correction lineage.

## Boundaries

- Platform owns the infrastructure, indexing, model/provider custody, quotas, retention policy, and governance controls.
- A Brand owns its operational context, corrections, review decisions, and permitted insight publication.
- Industry packs only define schemas, labels, and workflows that may emit observations. They never receive a separate memory implementation or cross-tenant access.
- DENTEX and WeRealtors remain future reference packs, not runtime assumptions.
- No cross-tenant training or retrieval is enabled by this ledger. Any aggregate use requires a separately governed, consented, de-identified pipeline.

## Acceptance criteria

1. Every row carries tenant and organization provenance and is protected by forced RLS.
2. Replayed source events are idempotent per tenant.
3. Evidence is digest-addressed and linked to the observation that produced it.
4. Insights cannot be mistaken for facts: confidence, model/version, status, and correction lineage are mandatory.
5. Provider credentials and model calls remain outside Brand scope.
