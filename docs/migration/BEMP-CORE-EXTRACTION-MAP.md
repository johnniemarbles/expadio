# BEMP Core Extraction Map

**Status:** Initial audit baseline

## Source

`johnniemarbles/BEMP`

The BEMP repository is already a pnpm workspace with `@bemp/core`, `@bemp/spatial`, `@bemp/web` and `@bemp/ai-runtime` development paths. Its core package uses NestJS, TypeORM and PostgreSQL and already contains extensive communication readiness, webhook, retry-safety and routing checks.

## Promote to EXPADIO Core

| BEMP capability | EXPADIO target | Action |
|---|---|---|
| Core API/domain | `packages/core-domain` + `apps/api` | Extract boundary, preserve behavior |
| Identity/roles/authority | `packages/iam` + `packages/authorization` | Normalize contracts |
| Tenant/org context | `packages/tenancy` | Make explicit canonical context |
| Leads/intake | `packages/leads` | Promote to core |
| CRM/people/orgs | `packages/crm` | Promote to core |
| Cases/agreements | `packages/cases` | Promote to core |
| Workflow/Decision Fabric | `packages/workflow` | Preserve as canonical engine |
| Assignment | `packages/workflow` / assignment boundary | Normalize targets and strategies |
| Communication | `packages/communication` | Keep existing safety contracts; hide providers |
| AI runtime | `packages/ai` | Extract provider-neutral interface |
| Spatial/territory | `packages/core-domain` or dedicated package after audit | Do not duplicate |
| Audit/provenance | `packages/audit` | Make cross-cutting |
| Web UI | appropriate experience app | Extract UX, not a second backend |

## Provider dependencies observed in BEMP core

The current core package directly declares PostgreSQL/TypeORM and communication providers including AWS SES, Resend and Twilio. This is acceptable in the source repository but must be moved behind EXPADIO provider interfaces as capabilities are promoted.

## Existing evidence worth preserving

BEMP already has checks for:

- communication pipeline
- engagement contracts
- live readiness
- provider safety/certification
- inbound idempotency
- outbound reconciliation
- provider retry safety
- distributed throttling
- SMS/WhatsApp/email/voice webhooks
- social integrations

These tests are migration assets. Do not discard them when moving boundaries.

## Gaps to resolve during extraction

1. Exact IAM/tenant model and database schema ownership.
2. Direct provider imports outside communication adapters.
3. AI runtime coupling to specific providers.
4. Cross-module authorization consistency.
5. Event/outbox contracts.
6. Data provenance and AI-derived mutation controls.
7. Storage abstraction.
8. Infrastructure configuration and secrets boundaries.

## Rule

This map is not permission to copy the repository wholesale. Every target package must be justified by code ownership, dependency analysis and passing evidence.
