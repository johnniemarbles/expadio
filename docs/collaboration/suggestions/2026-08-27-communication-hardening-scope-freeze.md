# Communication Production Integration & Hardening Scope Freeze

**Proposed by:** Human  
**Date:** 2026-08-27  
**Status:** Accepted  
**Related area:** `docs/architecture/P0-C-COMMUNICATION-FOUNDATION-STATUS.md`, `docs/migration/P0-D-DECISION-FABRIC-EXTRACTION-BOUNDARY.md`

## Problem / Opportunity

To prevent scope creep and ensure clear sequence boundary gates between the Core Spine migration tracks (P0-D Workflow, P0-E Business Configuration, P0-F AI/Intelligence) and the operational hardening of horizontal capabilities.

## Proposal

Lock the sequence order as follows:
1. **Continue P0-D:** Complete the Workflow and Decision Fabric extraction, validation, and transition engine runtime.
2. **Execute P0-E:** Extract and establish the Business Configuration runtime.
3. **Execute P0-F:** Extract and establish the AI & Data Intelligence layer (including STT, TTS, conversational AI, call intelligence, summaries, extraction, and AI orchestration).
4. **Return to Communication Production Integration & Hardening:** Post-P0-F, harden the core/domain Communication capability into a production-operational state.

The post-P0-F Communication phase will explicitly include:
- Email, SMS, WhatsApp, telephony, and push adapters.
- Provider-specific webhook endpoints and signature validation.
- Queue, scheduler, retry, reconciliation, and dead-letter workers.
- Secrets/KMS integration and credential rotation.
- Provider provisioning and control-plane UI.
- Unified inbox and campaign-authoring UI.
- Deliverability, usage, cost, and provider-health dashboards.
- Sandbox-to-production certification, failover, observability, and load testing.

### Provider-Neutral Constraint
The completed architecture must remain provider-neutral. P0-F (AI/Intelligence) may consume Communication's transport contracts, events, and voice foundation, but all AI-specific logic must remain isolated within the AI layer.

## Expected benefits

- Preserves focus on core spine extraction first (P0-D through P0-F) without getting bogged down in infrastructure adapters/telephony details.
- Avoids mixing AI capability logic into the transport/delivery layers of the Communication package.
- Clear boundary contracts between transport foundation and live providers.

## Risks / trade-offs

- Production-level telephony and messaging verification remain simulated in local development and sandbox fixture formats until all core spines are complete.

## Decision trail

- **2026-08-27** — Proposed and Accepted by Human (scope frozen for core sequence and Communication production integration requirements).
