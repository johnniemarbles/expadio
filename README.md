# EXPADIO

EXPADIO is the master business-expansion platform. **BEMP is the core business engine**; verticals such as tenant brands, tenant brands, Nordrux, Insurance and TPA/LIMS consume the same horizontal platform capabilities.

## Architecture status

**Conceptually frozen — implementation now proceeds by extraction, normalization and controlled migration.**

### Core principles

- BEMP remains the universal business engine.
- Vertical terminology and domain models are configurable through Industry Packs; core services remain industry-neutral.
- Communication is a BEMP core capability: email, SMS, voice and related channels.
- AI is a first-class intelligence layer, not a collection of vertical-specific integrations.
- Voice intelligence covers telephony, STT, TTS, conversation, extraction and call intelligence.
- Data & Intelligence Orchestration handles events, extraction, enrichment, indexing and AI jobs.
- Authentication is provider-backed but authorization remains in EXPADIO/BEMP.
- PostgreSQL is the canonical relational data model; Supabase is an initial managed provider, not an architectural dependency.
- Railway is an initial deployment provider, not an architectural dependency.
- BYOK, BYOC, BYOD and white-label deployment are first-class requirements.
- Web, mobile, API, embedded and AI-agent experiences are channels over the same platform APIs.
- Public, Platform, Brand, Client and Partner are distinct experience audiences.

## Initial provider defaults

- Identity: Clerk candidate/default
- Database: PostgreSQL via Supabase candidate/default
- Storage: Supabase Storage candidate/default, behind an object-storage interface
- Hosting: Railway candidate/default
- Edge/security: Cloudflare candidate/default
- AI/voice/communication providers: routed through provider gateways and replaceable adapters

## Repository strategy

EXPADIO is the target master repository. Existing repositories are source material until their capabilities are classified as:

1. **KEEP AS CORE**
2. **PROMOTE TO HORIZONTAL**
3. **VERTICALIZE**
4. **REFACTOR**
5. **RETIRE**

No destructive migration is performed until the extraction matrix and architecture decision records are approved by CI/evidence.

## Architecture documents

- `docs/architecture/EXPADIO-MASTER-ARCHITECTURE.md`
- `docs/architecture/AI-INTELLIGENCE-AND-VOICE.md`
- `docs/architecture/PROVIDER-ABSTRACTION-BYOK-BYOC.md`
- `docs/migration/REPOSITORY-EXTRACTION-MATRIX.md`
