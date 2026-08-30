# EXPADIO Platform Completion Checklist

Status: active project memory  
Owner: platform program  
Last updated: 2026-08-30  
Current strategy: platform completion before vertical expansion

This checklist is the durable project memory for autonomous execution. Update it in every platform PR when a task is completed, paused, or newly discovered.

## Current strategy lock

- [x] Pause DENTEX clinical/product-depth work until full platform capability is broader.
- [x] Pause additional vertical implementation until platform completion program reaches the AI/knowledge/agent/voice foundation stage.
- [x] Treat the horizontal execution foundation as frozen except for targeted hardening and capability completion.
- [x] Use the repository, not chat memory, as the durable checklist of completed work.

## Completed foundation milestones

### Execution spine

- [x] Tenancy / RLS model established as canonical tenant boundary.
- [x] Decision Fabric established as governed workflow primitive.
- [x] Domain Event Fabric implemented.
- [x] Transactional outbox implemented.
- [x] Lease-safe event worker implemented.
- [x] Multi-tenant scheduler implemented.
- [x] Dead-letter/recovery concepts represented.
- [x] Governed Action Fabric implemented.
- [x] `COMMUNICATE` executor implemented.
- [x] `SCHEDULE` executor implemented.
- [x] `CREATE_TASK` executor implemented.

### Communications

- [x] Durable communication delivery queue implemented.
- [x] Delivery claim/lease behavior implemented.
- [x] Late compliance check implemented before provider side effect.
- [x] Verified sender path implemented.
- [x] Credential lease path implemented.
- [x] Resend provider execution implemented.
- [x] Provider attempt evidence implemented.
- [x] Provider acceptance reconciliation implemented.
- [x] Provider webhook evidence table implemented.
- [x] Internal verified provider webhook ingestion implemented.
- [x] Verified Resend webhook HTTP route implemented.
- [x] Demo/default webhook fallbacks removed from production route.
- [x] Provider webhook lifecycle transition matrix implemented.
- [x] Out-of-order provider lifecycle events recorded without stale state regression.
- [x] Replayed provider webhook events with distinct provider event ids recorded without duplicate delivery lifecycle mutation.

### Observability

- [x] `platform.business_execution_trace` read model implemented.
- [x] `GET /api/execution/trace` implemented.
- [x] Read-only `/execution-trace` operator surface implemented.
- [x] `platform.execution_health_summary` read model implemented.
- [x] `GET /api/execution/health` implemented.
- [x] `platform.communication_health_summary` read model implemented.
- [x] `GET /api/communications/health` implemented.
- [x] `platform.scheduler_health_summary` read model implemented.
- [x] `GET /api/scheduler/health` implemented.
- [x] `platform.outbox_health_summary` read model implemented.
- [x] `GET /api/outbox/health` implemented.
- [x] Read-only `/platform-health` operator dashboard implemented.
- [x] Explicit stuck communication delivery health buckets implemented.
- [x] Due scheduled-action detection covered by scheduler health read model and source-contract guard.

### Foundation governance

- [x] Foundation freeze document created.
- [x] Platform completion checklist created.

## P0 — platform hardening and operations

### Provider lifecycle transition hardening

- [x] Define explicit communication delivery state transition matrix.
- [x] Add database-level or application-level allowed transition guard.
- [x] Add tests for duplicate provider webhooks.
- [x] Add tests for replayed provider webhooks.
- [x] Add tests for out-of-order lifecycle events.
- [x] Add tests for terminal-state behavior.
- [x] Confirm canonical semantics for `DELIVERED -> BOUNCED` and `BOUNCED -> DELIVERED`.

### Execution health and monitoring

- [x] Add execution health read model.
- [x] Add communication health read model.
- [x] Add scheduler health read model.
- [x] Add outbox health read model.
- [x] Add execution health API.
- [x] Add communications health API.
- [x] Add scheduler health API.
- [x] Add outbox health API.
- [x] Add platform health dashboard.
- [x] Add stuck delivery detection.
- [x] Add due scheduled-action detection.
- [ ] Add unmatched webhook detection.
- [ ] Add stale provider-attempt reconciliation detection.

### Governed recovery

- [ ] Add governed recovery command model.
- [ ] Add recovery queue API.
- [ ] Add recovery command center.
- [ ] Add retry command.
- [ ] Add cancel command.
- [ ] Add mark-resolved command.
- [ ] Add create-task escalation command.
- [ ] Add recovery audit and trace evidence.

## P1 — Action Fabric breadth

- [ ] Add `ASSIGN` executor.
- [ ] Add `REQUEST_APPROVAL` executor.
- [ ] Add outbound `WEBHOOK` delivery model.
- [ ] Add governed `WEBHOOK` executor.
- [ ] Add `START_WORKFLOW` executor.
- [ ] Add `ADVANCE_WORKFLOW` executor.
- [ ] Add `CREATE_DOCUMENT` executor.

## P1 — authorization normalization

- [ ] Add capability-level permission vocabulary.
- [ ] Add `platform.execution.read` capability.
- [ ] Add `platform.execution.recover` capability.
- [ ] Add `platform.communications.manage` capability.
- [ ] Add `platform.communications.trace.read` capability.
- [ ] Add `platform.scheduler.manage` capability.
- [ ] Add `platform.governance.review` capability.
- [ ] Migrate horizontal APIs off CRM-named authorization helpers.
- [ ] Add source-contract tests for capability-level authorization guards.

## P1 — CI and behavioral E2E

- [ ] Add dedicated database contract workflow.
- [ ] Add RLS regression workflow.
- [ ] Add Action Fabric contract workflow.
- [ ] Add Communications lifecycle integration workflow.
- [ ] Add Scheduler lifecycle integration workflow.
- [ ] Add Provider webhook lifecycle workflow.
- [ ] Add event-to-provider-to-webhook-to-trace E2E harness.
- [ ] Add event-to-schedule-to-child-action-to-trace E2E harness.
- [ ] Add event-to-create-task-to-trace E2E harness.

## P1/P2 — Knowledge Engine foundation

- [ ] Add `knowledge_sources` model.
- [ ] Add `knowledge_documents` model.
- [ ] Add `knowledge_chunks` model.
- [ ] Add embedding provider abstraction.
- [ ] Add tenant-scoped retrieval API.
- [ ] Add retrieval provenance.
- [ ] Add citation support.
- [ ] Add knowledge retention policy hooks.

## P1/P2 — AI Gateway foundation

- [ ] Add AI provider config schema.
- [ ] Add AI model policy schema.
- [ ] Add AI job runtime model.
- [ ] Add AI job messages/outputs model.
- [ ] Add AI usage/cost audit.
- [ ] Add provider adapter interface.
- [ ] Add AI proposal model.
- [ ] Add AI proposal to Governed Action handoff.
- [ ] Enforce no direct AI business mutation.

## P2 — Agent Runtime foundation

- [ ] Add agent identity model.
- [ ] Add agent scope model.
- [ ] Add agent tool permission model.
- [ ] Add agent run/step/tool-call trace.
- [ ] Add agent budget model.
- [ ] Connect agent proposals to Action Fabric.

## P2 — Voice Gateway foundation

- [ ] Add voice provider config model.
- [ ] Add voice session model.
- [ ] Add recording consent events.
- [ ] Add STT/TTS provider abstraction.
- [ ] Add transcript retention controls.
- [ ] Add redaction events.
- [ ] Add voice escalation model.
- [ ] Connect voice outcomes to AI proposal / Action Fabric.

## P2 — API / SDK / embedded platform

- [ ] Add external event ingestion API.
- [ ] Add API key / service identity model.
- [ ] Add event ingestion SDK.
- [ ] Add embedded execution trace surface.
- [ ] Add embedded workflow panel.
- [ ] Add embedded communication status panel.

## P2 — Platform Admin completion

- [ ] Add execution operations console.
- [ ] Add provider operations console.
- [ ] Add credential operations console.
- [ ] Add AI policy console.
- [ ] Add knowledge source console.
- [ ] Add scheduler operations console.
- [ ] Add audit export console.

## P2 — billing, usage, entitlement

- [ ] Add usage event model.
- [ ] Add usage rollups.
- [ ] Add billing account model.
- [ ] Add plan / entitlement model.
- [ ] Add quota policy checks.
- [ ] Add overage events.
- [ ] Add usage dashboard.

## P2/P3 — security and compliance

- [ ] Add retention policy framework.
- [ ] Add audit export.
- [ ] Add tenant data export.
- [ ] Add tenant deletion workflow.
- [ ] Add field-level redaction controls.
- [ ] Add credential rotation alerts.
- [ ] Add secret inventory health checks.
- [ ] Add data residency policy hooks.

## Paused vertical/product work

- [ ] DENTEX clinical ontology.
- [ ] DENTEX care plan product.
- [ ] DENTEX appointment scheduling.
- [ ] DENTEX richer patient communications.
- [ ] WeRealtors.
- [ ] Nordrux / TPA / LIMS.
- [ ] Insurance.
- [ ] LMS.
- [ ] Community.
- [ ] Jobs.
- [ ] Marketplace.
- [ ] Mobile app product depth.

## Hygiene backlog

- [ ] Remove obsolete Communications `route.ts.tmp` artifact if still present.
- [ ] Audit production code for implicit demo tenant/default connector fallbacks.
- [ ] Add source-contract guard against production demo fallbacks.
