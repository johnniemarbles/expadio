# P0-C Communication Foundation Status

**Status:** Foundation complete; provider implementations and product surfaces intentionally deferred

## 1. Ownership

BEMP Communication is the canonical EXPADIO transport and delivery layer for:

- email
- SMS and supported messaging channels
- push/in-app notification delivery
- voice transport
- conversations / unified inbox
- templates
- sender identities
- suppression / consent enforcement
- provider routing
- delivery state and provider evidence

AI voice intelligence is not owned here. STT, TTS, conversational reasoning, extraction and call intelligence belong to the EXPADIO AI & Intelligence layer and consume Communication voice transport/evidence.

## 2. Implemented foundation

The current core establishes provider-neutral contracts and persistence for:

- communication intent and channel identity
- conversation model
- suppression and consent preflight
- template resolution and deterministic rendering
- sender identity resolution
- provider registry and connector routing
- provider adapter registry
- provider-neutral send requests
- idempotent provider send attempts
- retry classification without hidden sleeping/scheduling
- delivery lifecycle persistence
- provider message identity
- signed webhook normalization boundary
- verified webhook ingestion
- duplicate provider-event handling
- stale/regressive event protection
- voice call lifecycle contract
- voice session persistence and append-only event evidence
- voice repository port and PostgreSQL adapter
- recording/transcript reference persistence
- voice webhook normalization and ingestion
- explicit inbound voice bootstrap through injected context/ID resolution
- tenant isolation/RLS regression coverage
- composed send -> provider acceptance -> verified webhook -> delivered regression coverage

## 3. Explicit invariants

1. Business modules do not call email/SMS/voice provider SDKs directly.
2. Provider payloads never become core domain contracts.
3. Signature verification happens before webhook-driven repository mutation.
4. Delivery/call state changes are deterministic and validated.
5. Idempotency keys cannot be silently reused across different connector/adapter routes.
6. Provider event identities are deduplicated.
7. Late voice evidence such as recording/transcript references is retained even when lifecycle state is unchanged.
8. Communication does not guess inbound call organization, conversation, agent or internal call ID.
9. Retry decisions are returned to an external scheduler/queue; Communication does not sleep or self-schedule.
10. Notification delivery belongs to BEMP Communication; horizontal/vertical modules emit intents rather than fork transport engines.

## 4. Deliberately deferred

The following are not required to declare the P0-C foundation complete and must be implemented as later integration/product slices:

- concrete SendGrid / SES / Postmark / Resend adapters
- concrete SMS/WhatsApp providers
- concrete telephony providers
- HTTP/API controllers and provider-specific webhook endpoints
- queue/scheduler worker implementation
- push provider implementation
- customer-facing unified inbox UI
- campaign authoring UI
- deliverability dashboards
- provider setup/control-plane UI
- STT/TTS/conversational AI
- AI call analysis and extraction
- production secrets/KMS wiring for concrete providers

Those features must consume the current provider-neutral interfaces instead of bypassing them.

## 5. Gate for future Communication work

Any future Communication feature must preserve:

```text
Business capability / workflow
        -> Communication intent
        -> policy + consent + suppression
        -> template / sender resolution
        -> connector routing
        -> provider-neutral adapter contract
        -> provider
        -> verified provider event
        -> delivery / call evidence
```

Voice intelligence extends the flow after/beside voice transport; it does not move telephony transport ownership out of Communication.

## 6. P0-C closure decision

P0-C is closed at the **foundation boundary** when this document is merged with all current Core Spine and architecture baseline checks green.

The next core phase is **P0-D Workflow / Decision Fabric**, with Communication treated as an available core dependency rather than reopened as a competing architectural track.
