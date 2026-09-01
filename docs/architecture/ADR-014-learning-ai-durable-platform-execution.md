# ADR-014 — Learning AI uses durable shared platform execution

**Status:** Accepted for LMS-08  
**Scope:** Shared Learning AI + horizontal AI execution durability

## Decision

Learning does not call OpenAI, Gemini, or any other model provider directly.

The supported path is:

```text
Learning AI request
  → immutable Learning request linkage
  → immutable AI job registration
  → tenant-scoped INPUT / CONTEXT artifacts
  → leased AI execution queue
  → provider registry routing
  → governed short-lived credential lease
  → infrastructure secret resolution
  → provider-neutral AI gateway
  → OpenAI / Gemini adapter
  → tenant-scoped OUTPUT artifact + provenance
  → append-only AI job success/failure events
  → intelligence usage evidence
  → Learning request status/read
```

## Ownership

### Learning owns

- tenant AI feature enablement;
- Learning request type and Learning-specific prompt configuration key;
- learner/course context selection;
- learner-bound access to tutor/coach requests;
- administrative access to authoring/assessment-feedback requests;
- immutable Learning→AI job linkage;
- rendering the resulting proposal/observation to Learning users.

### EXPADIO platform owns

- AI job lifecycle;
- queue leasing and retry;
- provider routing;
- provider/model adapters;
- credential custody and short-lived lease authorization;
- Vault/secret resolution;
- output/provenance persistence;
- cost/usage evidence;
- provider failure behavior.

Provider configuration remains a Platform capability. Learning administrators do
not enter OpenAI/Gemini credentials.

## Reference-only job history

`platform.ai_jobs` remains an immutable reference-oriented ledger.

Prompt/context/output content is not stored directly in job registration or job
event reference fields. New `platform.ai_job_artifacts` rows hold tenant-scoped
content and jobs retain opaque references such as:

```text
ai-artifact://<uuid>
```

Artifacts are:

- FORCE-RLS tenant scoped;
- immutable;
- typed as INPUT, CONTEXT, or OUTPUT;
- linked to exactly one AI job.

Provider adapters may return ephemeral output content to the worker. That content
must be persisted into an OUTPUT artifact before a durable SUCCEEDED event is
recorded.

## Execution queue

Mutable delivery state is separate from immutable AI history in
`platform.ai_job_execution_queue`.

The queue supports:

- one row per tenant/job;
- SKIP LOCKED claim;
- lease expiration recovery;
- bounded attempts;
- retry scheduling;
- terminal COMPLETED/DEAD state;
- tenant FORCE RLS.

The AI job itself is never mutated to represent worker state.

## Credential boundary

The AI worker uses the same custody pattern already proven by Communications:

1. route an enabled compliant connector;
2. load only its managed credential reference through infrastructure runtime;
3. authorize `credential.lease` for the AI worker service identity;
4. issue an audited short-lived lease;
5. resolve the secret only after lease success;
6. pass plaintext directly to the provider adapter;
7. never persist plaintext credentials.

Learning code imports none of the credential/provider implementation.

## Learning request security

`TUTOR` and `COACH` requests must resolve an ACTIVE
`platform.learning_learners` row bound to the authenticated subject and
issuer.

`AUTHOR_DRAFT` and `ASSESSMENT_FEEDBACK` are administrative Learning
surfaces.

Disabling `learning_tenant_settings.ai_features_enabled` blocks new AI
requests but does not hide historical results while the Learning module itself
remains operational.

Module suspension still follows the shared module lifecycle contract.

## AI output semantics

AI output remains an observation/proposal.

LMS-08 does not allow AI to:

- publish course content automatically;
- mutate assessment grades;
- award competencies;
- issue credentials;
- complete certifications;
- change learner progress;
- bypass deterministic or human review.

Those mutations must continue through their existing authorized domain runtimes.

## Cost and provenance

A successful execution records:

- connector;
- provider;
- model;
- prompt configuration key/version;
- source artifact references;
- region when available;
- confidence when available;
- provider cost;
- one `AI_REQUEST` intelligence usage event.

Tenant-owned connectors are attributed as BYOK; platform connectors are
attributed as EXPADIO-managed.

## Crash/replay behavior

If a worker crashes after a durable SUCCEEDED event but before queue completion,
the next claim reconstructs the append-only job state and completes the queue
without another provider call.

If execution fails before success, FAILED and (when attempts remain)
RETRY_SCHEDULED events preserve the attempt history.

A provider may still have accepted a request immediately before a process crash.
Provider-level idempotency should be used where a provider supports it; the
platform's durable job idempotency key is stable across retries.

## Deliberate non-goals

LMS-08 does not add:

- a Learning-specific model gateway;
- a Learning-specific provider account;
- autonomous publication;
- automatic grading mutation;
- vector/embedding artifact persistence;
- live streaming tutor tokens;
- voice tutoring;
- unrestricted agent tools;
- model fine-tuning;
- arbitrary prompt-template administration.

Those are later bounded slices or shared platform capabilities.
