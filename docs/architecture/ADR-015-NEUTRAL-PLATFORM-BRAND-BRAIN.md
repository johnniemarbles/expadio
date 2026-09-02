# ADR-015: Neutral Platform, Brand Execution and Brand Brain

**Status:** Accepted  
**Date:** 2026-09-02

## Decision

EXPADIO is a brand-neutral infrastructure and intelligence platform. It provides identity, tenancy, workflow, decision, communication, knowledge, AI, audit, commercial entitlement and industry-pack engines. A Brand composes those engines into its own operating platform.

DENTEX and WeRealtors are not core products or privileged runtime branches. They may become separately released reference Brands or optional industry-pack examples. Core routes, navigation, authorization and engine contracts must not depend on either name.

## Ownership

Platform Administration owns tenant lifecycle, global policy, commercial entitlements, provider integrations, credential custody, routing ceilings, module and pack registries, shared engines and cross-tenant observability.

A Brand owns its enterprise data, customers, cases, conversations, campaigns, activated modules, bounded workflow customization and private Brand Brain. A Brand never mints Platform policy, reads Platform credentials, grants itself entitlement or accesses another tenant.

Industry and niche selection recommends terminology, ontologies, workflow templates, compliance controls and knowledge. A pack never grants entitlement, changes authorization or hardcodes a Brand name into a shared engine. Packs are versioned, explainable, replaceable and support bounded relabelling without changing semantic identifiers.

## Brand Brain

Each Brand receives a private intelligence layer built from authorized evidence: calls, conversations, workflow transitions, decisions, tasks, movements, outcomes, exceptions, documents and user corrections.

Platform supplies ingestion, transcription, embeddings, retrieval, reasoning, evaluation, provenance, cost controls and governed-action bridges. The Brand owns its isolated memory and derived insights.

Every insight retains tenant and organization provenance, source evidence, confidence, model/version and correction history. AI may recommend, summarize, detect patterns and prepare governed actions. It may not bypass consent, workflow authority, separation of duties or human review.

Cross-tenant learning and benchmarking are prohibited by default. Any future benchmark requires explicit opt-in, aggregation, privacy review and non-reidentification controls.

## Composition

```text
Platform registry
  -> commercial entitlement
  -> Brand activation
  -> industry and niche recommendations
  -> bounded Brand configuration
  -> user authorization
  -> Brand workspace
  -> Brand Brain evidence and insights
```

Modules define capability and structure. Industry packs define recommended semantics and defaults. Themes define presentation. None grants the authority of another layer.

## Migration rule

Tenant operational screens leave Platform navigation before migration. Their engines remain available and tested. New tenant operations land in `apps/brand-web`; fleet and control-plane operations land in `apps/platform-web`.
