# EXPADIO Company Brain (CBOS)

**Status:** Accepted architecture decision; incremental implementation baseline

## Decision

EXPADIO Company Brain is a governed control plane composed from existing BEMP and EXPADIO capabilities. It is not a standalone workflow, knowledge, authorization, configuration, audit, or agent engine.

The product name is **EXPADIO Company Brain (CBOS)**. The architectural capability is the **Company Brain Control Plane**.

## Purpose

CBOS lets an organization learn once and reuse approved knowledge, judgment, and capabilities without treating chats or model output as authoritative truth. It provides:

- tenant-scoped maps of approved source references;
- deterministic source precedence;
- purpose-limited progressive context slices;
- governed skills and worker definitions;
- correction proposals routed through review and publication;
- provenance, authorization, retention, and audit for every use.

## Composition boundary

| CBOS concern | Canonical EXPADIO owner |
| --- | --- |
| Facts and organizational knowledge | Knowledge and Context Engine |
| Policies, decisions, priorities, and publication | Business Configuration |
| Execution and approval | Workflow / Decision Fabric |
| Skills and workers | Capabilities and Agent Runtime |
| Model and tool providers | AI Gateway and Provider Registry |
| Credentials | Scoped credential leases |
| Learning proposals | Workflow decisions and configuration changesets |
| Provenance and sensitive access | Audit |

CBOS must extend these owners through neutral contracts. It must not bypass or duplicate them.

## Governed precedence

Highest authority is resolved first:

1. Platform safety, security, and legal invariants
2. Applicable jurisdiction policy
3. Applicable tenant policy
4. Approved active business decisions and ADRs
5. Active priorities and operational state
6. Verified facts
7. Approved capabilities, skills, and workers
8. Unreviewed correction proposals

Unreviewed proposals are visible only to review workflows. They cannot enter an executable context bundle as truth.

## Brain Map contract

A Brain Map is a versioned `BRAIN_MAP` business-configuration object with tenant scope. It contains only:

- stable source identifiers;
- provider-neutral source references;
- SHA-256 content digests;
- source kind and review status;
- effective dates and classifications;
- purpose-specific slice definitions;
- bounded item limits.

It does not contain raw source content, prompts, outputs, credentials, or protected payloads. Sources remain under their canonical owners and are loaded only after authorization.

## Correction lifecycle

1. Capture a categorized proposal with evidence references and redacted or digest-based differences.
2. Record it immutably as unreviewed.
3. Route it through Workflow / Decision Fabric.
4. Convert an accepted proposal into a Business Configuration changeset.
5. Apply deterministic validation and human approval.
6. Publish and re-index the approved version.
7. Re-evaluate affected slices and retain complete audit provenance.

No model or agent may publish its own correction directly.

## Delivery order

1. Tenant-scoped Brain Map contract and validation
2. Authorized progressive context-bundle composition
3. Correction proposal and publication loop
4. Governed skill and worker manifests
5. Durable provider-neutral agent sessions
6. Typed graph compilation through Decision Fabric
7. Budgeted multi-agent orchestration where benchmarks justify it

Single-agent execution remains the default. Multi-agent execution requires bounded fan-out, depth, concurrency, tools, context, and cost.

## Non-negotiable invariants

- Zero cross-tenant context access
- Zero unreviewed knowledge in executable context
- Source provenance on every resolved item
- Authorization before retrieval
- Human approval before authoritative publication
- Reference-only credentials and sensitive-content records
- Deterministic policy gates before state mutation
- Provider-neutral domain contracts
- Explicit retention and data-residency behavior
- No second workflow, knowledge, configuration, authorization, or audit engine
