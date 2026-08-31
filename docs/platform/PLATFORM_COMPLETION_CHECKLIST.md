# EXPADIO Platform Completion Checklist

Status: active project memory  
Owner: platform program  
Last updated: 2026-08-31  
Current strategy: platform completion before vertical expansion

This checklist is the durable project memory for autonomous execution. Update it in every platform PR when a task is completed, paused, or newly discovered.

## Current strategy lock

- [x] Pause DENTEX clinical/product-depth work until full platform capability is broader.
- [x] Pause additional vertical implementation until platform completion program reaches the AI/knowledge/agent/voice foundation stage.
- [x] Treat the horizontal execution foundation as frozen except for targeted hardening and capability completion.
- [x] Use the repository, not chat memory, as the durable checklist of completed work.
- [x] Freeze exception 2026-08-31: AutoGTM / Demand Generation Control Plane (#483) may proceed on Communication + Decision Fabric only.
- [x] Freeze exception 2026-08-31: Social Content may proceed on Communication + Decision Fabric only. Lab `expadio-social-content` must be closed before EXPADIO send wiring. Owner: complete remaining lab scope first; no live social send until COMMUNICATE is proven.

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
- [ ] Social channel `social` + capability `communication.social.send` on main (wired on #489; not merged).
- [ ] Disabled connector `social.linkedin` on main (wired on #489; not merged).
- [ ] Delivery-worker social dispatch — forbidden until COMMUNICATE proof + explicit enable.

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
- [x] Unmatched provider webhook detection covered by communication health read model and source-contract guard.
- [x] Stale provider-attempt reconciliation detection covered by communication health read model and smoke/source-contract guards.

### Foundation governance

- [x] Foundation freeze document created.
- [x] Platform completion checklist created.

## AutoGTM / Demand Generation Control Plane (#483)

Freeze exception 2026-08-31. Native Explee-like demand generation on EXPADIO. Not a vendor integration. Engines stay in `johnniemarbles/expadio-demand-generation` until COMMUNICATE is proven on a tenant-bound connector.

### Done on main

- [x] Platform slice: `platform.gtm_*` + forced RLS (#487).
- [x] Four PLATFORM Decision Fabric work types: `gtm.icp.publish`, `gtm.sequence.publish`, `gtm.campaign.launch`, `gtm.meeting_request` (#487).
- [x] Connector `gtm.email` seeded DISABLED on `communication.email.send` / `resend` (#487).
- [x] CRM lead ingest `source=outbound_gtm` + `raw_payload` first (#487/#488).
- [x] File Communication intent after DF APPROVE; keep `gtm.email` dark (#488).
- [x] Sequence and meeting-request list/create APIs (#488).
- [x] Reply observation ingest onto existing CRM leads (#488).

### Next on EXPADIO

- [ ] Seed-tenant proof: file ICP / sequence / campaign, bind DF, APPROVE as a second subject.
- [ ] Seed-tenant proof: `POST /api/gtm/sequences/:id/communicate` returns `sent: false` while `gtm.email` is disabled.
- [ ] Seed-tenant proof: `POST /api/gtm/replies` with `interested` / `meeting_requested` creates a CRM lead `source=outbound_gtm`.
- [ ] Persist the filed Communication intent as a real `COMMUNICATE` Action Intent — do not dispatch while `gtm.email` is dark.
- [ ] `/gtm` console: bind workflow, assign reviewer, APPROVE in-place (SoD, no auto-approve).
- [ ] Meeting-request create + owner review in the governance queue.
- [ ] Prospect observation rows as observations only (no second CRM).
- [ ] Enable `gtm.email` only after tenant BYOC + sender identity.
- [ ] Prove COMMUNICATE delivery on that tenant-bound connector.
- [ ] Merge `gtm-*` engines from `expadio-demand-generation` after that proof.

### Forbidden

- [ ] Auto-approve / auto-send.
- [ ] New Action Fabric type `SEND_OUTBOUND`.
- [ ] Lab adapter `gtm-email-lab-v1` on platform.
- [ ] Second CRM.
- [ ] Merge extract `apps/*` / lab UI onto main.

## Social Content Control Plane (ADR-007)

Freeze exception 2026-08-31. Social *send* is a BEMP Communication connector, not a new Action Fabric executor `PUBLISH_SOCIAL`. Decision Fabric `social.content_publish` only authorizes copy. Lab: `johnniemarbles/expadio-social-content` (catalog 0.6.1 + calendar 0.6.2 closed on lab main 2026-08-31).

Binding keys:

| Field | Value |
|-------|--------|
| channel | `social` (subjectId; not a sender-identity channel) |
| capability | `communication.social.send` |
| first connector | `social.linkedin` PLATFORM **enabled=false** |
| provider / adapter | `linkedin` / `linkedin-social-text-v1` |
| lease purpose | `communication.social.send:{purpose}` |
| evidence | `PublishEvidence.externalPostId` → `communication_provider_attempts.provider_message_id` |

### Done off-platform (lab closed)

- [x] Lab Phases 0–3: connectors, AI content, research, calendar/forensics.
- [x] Channel catalog 0.6.1: Threads / IG / TikTok PULL_FROM_URL + status poll / YouTube resumable+PUT / Bluesky / Pinterest / GBP.
- [x] Calendar 0.6.2: ingest research → draft calendar → slot-to-intent (copy only; not a send path).
- [x] ADR-007: Communication connector, not `PUBLISH_SOCIAL`.
- [x] Lab registration contract: `docs/architecture/COMMUNICATION-ADAPTER-REGISTRATION.md` on the lab repo.

### In flight on EXPADIO (not on main)

- [x] Dark Communication wiring branch `feat/social-communication-wiring` (#489): channel union, capability seed, disabled `social.linkedin`, LinkedIn text adapter, Resend-shaped lease binding, CHECK widen, adapter-key map.
- [ ] Merge #489 onto main after migration-number reconciliation (see hygiene).
- [ ] Decision Fabric sketch `social.content_publish` (#482) — **HOLD**. Do not merge under freeze.

### Next on EXPADIO

- [ ] Reconcile migration number on #489 before merge. Draft #481 already uses `0085_audit_organization_provenance.sql`; #475 uses 0083/0084. Renumber social if those land first.
- [ ] Seed-tenant proof: connector `social.linkedin` exists, `enabled=false`, capability `communication.social.send`.
- [ ] File a Communication intent after DF APPROVE; author cannot file (SoD). Return dark / `CONNECTOR_DISABLED` while the connector is off.
- [ ] Do not add `social` to `CommunicationSenderChannel` / `isSenderChannel()`.
- [ ] Do not wire the delivery worker to LinkedIn until COMMUNICATE → attempt → trace is proven on email.
- [ ] Enable `social.linkedin` only after tenant BYOC + governed lease. ACCEPTED still requires provider message id (`x-restli-id`; synthetic ids fail closed).
- [ ] Then Meta Page text → X text → Threads → Instagram image → remaining catalog. Calendar expands to N intents, never a batch `send()`.
- [ ] Merge #482 only after COMMUNICATE proof + explicit freeze/checklist release for this vertical.

### Forbidden

- [ ] New Action Fabric type `PUBLISH_SOCIAL`.
- [ ] Nest `publish_jobs` as a production queue.
- [ ] Enabling `social.linkedin` without tenant BYOC + lease.
- [ ] Delivery-worker social dispatch while the connector is dark.
- [ ] Adding `social` to sender-identity CHECKs or `isSenderChannel()`.
- [ ] Silent / synthetic `external_post_id` mapped to ACCEPTED.
- [ ] Treating TikTok `publish_id` as a public watch URL.
- [ ] ACCEPTED on YouTube resumable init without a video id.
- [ ] Review replies as Communication send.
- [ ] Merging #482 under freeze.
- [ ] Registering Meta/X/Threads/IG/TikTok/YouTube/Bluesky/Pinterest/GBP on main in this window.
- [ ] Social in the Communications onboarding modal catalog.

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
- [x] Add unmatched webhook detection.
- [x] Add stale provider-attempt reconciliation detection.

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
- [ ] Reconcile migration 0085 collision before merging #489 and #481 (`0085_communication_social_channel.sql` vs `0085_audit_organization_provenance.sql`).
