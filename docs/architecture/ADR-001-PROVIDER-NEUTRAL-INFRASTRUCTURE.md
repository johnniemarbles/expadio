# ADR-001: Provider-Neutral Infrastructure

**Status:** Accepted

## Decision

EXPADIO will use provider adapters and a Provider Gateway for authentication, database, storage, communication, AI, voice and deployment dependencies.

Initial defaults are candidates, not architectural dependencies:

- Clerk for identity
- PostgreSQL/Supabase for managed relational data
- Supabase Storage/S3-compatible storage
- Railway for initial hosting
- Cloudflare for edge/security

## Consequences

Business modules cannot import provider SDKs directly. Provider configuration must be tenant/organization scoped where applicable, secret-managed, auditable and compatible with Managed, Hybrid and Customer-Controlled deployment modes.

The canonical domain model remains PostgreSQL-oriented. Firebase may be integrated for specific capabilities but is not the canonical EXPADIO database.

## Rationale

EXPADIO needs global footprint, regulated-vertical support, BYOK/BYOC/BYOD, white-label deployment and customer-controlled infrastructure without rewriting business modules.
