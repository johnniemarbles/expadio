# Strategy: Governed side-effect loop first (then multiply)

**Proposed by:** Grok  
**Date:** 2026-08-31  
**Status:** Accepted  
**Related area:** Platform program strategy; `docs/platform/FOUNDATION_FREEZE.md`; `docs/platform/PLATFORM_COMPLETION_CHECKLIST.md`; `docs/architecture/EXPADIO-MASTER-ARCHITECTURE.md`; agent task prioritization

## Problem / Opportunity

The horizontal execution foundation is frozen as the canonical platform architecture. The next goal is evidence that one existing business execution path works safely in live scope, including failure and recovery, rather than a broader inventory of partially connected capabilities.

The completion checklist is a planning record, not proof that an unchecked capability is absent. Before implementation, inspect current main, open PRs, code and tests. Preserve existing AI, voice and vertical capabilities; do not rebuild, remove or disable them merely because their checklist entries are stale. New vertical product-depth work remains paused under the existing freeze.

## Proposal

**Accepted direction:** Prove a closed, live-honest governed execution loop using existing horizontal primitives. Repair only gaps demonstrated by that proof. Subsequent vertical multiplication remains subject to the canonical program gates and a separate human release decision.

### Governed loop

Domain event → policy and Governed Action → existing executor → provider attempt/response evidence → reconciliation where applicable → execution trace and audit.

AI and agents emit recommendations, drafts or structured candidate actions. Business mutations require deterministic validation, policy, provenance, human approval when required, and a governed executor. They must not write business tables directly.

Operational repairs use authorized recovery commands through the existing execution infrastructure, never direct operator edits to delivery/business records. Ordinary lease-safe retries remain governed by existing policy; this strategy does not replace them with manual recovery.

### Priority sequence

| Order | Focus | Exit evidence |
|-------|-------|---------------|
| 0 | Verify the current baseline | Pin main SHA; inventory existing paths and related open PRs; identify gaps with file/test references. Check applicable CI, including the audit packs' Pack 0 precondition. |
| 1 | Live honesty and scope enforcement | Real session-derived tenant/organization/resource scope; no silent demo fallbacks or fabricated events; accurate empty states; behavioral denial and cross-scope tests. |
| 2 | Prove one existing execution scenario | Event → COMMUNICATE → evidenced provider outcome → reconciliation → matching trace/audit. Verify existing SCHEDULE and CREATE_TASK branches only where the scenario uses them. |
| 3 | Bounded governed recovery | Add only missing recovery commands needed by the scenario, together with authorization, duplicate/concurrency protection, and the acceptance tests below. |
| 4 | Verify AI proposal handoff | Existing AI output passes policy/provenance and approval when required before the same governed path executes. Rejected proposals cause no business mutation. |
| 5 | Verify one existing thin pack | Demonstrate the existing DENTEX mapping on the proven path without adding clinical/product depth or forking horizontal primitives. This is verification, not a vertical release gate override. |

Authorization is a prerequisite for every read, recovery command and external side effect. Tests ship with the corresponding change, not in a later security phase. Capability vocabulary cleanup may follow only when equivalent enforcement already exists and is tested.

### Bounded proof scenario

Use an existing DENTEX event/rule mapping to send one approved patient communication within a controlled, authorized live test scope. First record the exact existing event key, rule, template, recipient, sender, provider, and linked trace identifiers; do not invent a domain event or send to real patients as a testing shortcut. Any real provider send requires an explicitly approved test recipient and the normal consent, sender, credential and policy checks.

If the current mapping is unavailable, stop the pack-verification step and report the missing dependency. A generic platform event may prove the horizontal path but does not satisfy the DENTEX proof.

Exercise a provider failure or ambiguous outcome safely, reconcile the known outcome, then demonstrate an authorized recovery or escalation. Use SCHEDULE for a follow-up and CREATE_TASK for escalation only if the existing mapping requires them. Do not create unrelated functionality to enlarge the demonstration.

Additional executors (`ASSIGN`, `REQUEST_APPROVAL`, `WEBHOOK`, `START_WORKFLOW`, `ADVANCE_WORKFLOW`, `CREATE_DOCUMENT`) remain backlog items, not prerequisites for this milestone. Add one only through a bounded PR with evidence that the chosen scenario cannot complete using existing primitives.

### Recovery acceptance criteria

- Unauthenticated, unauthorized, wrong-tenant, wrong-organization and out-of-scope resource requests fail closed before side effects or protected data disclosure.
- Commands carry actor, scope, target, reason, idempotency identity and correlation references. Duplicate/replayed commands do not create a second logical recovery or duplicate delivery.
- Concurrent recovery requests and active workers obey existing claims, leases and lifecycle guards; terminal outcomes cannot be overwritten by stale work.
- Ambiguous provider outcomes are reconciled before considering resend. If acceptance cannot be determined safely, retain uncertainty and escalate; do not blindly retry a possibly completed external side effect.
- Retry rechecks current authorization, consent/compliance, sender, credential and lifecycle requirements. Cancellation does not imply reversal of an already completed provider effect.
- Success, denial and failure leave appropriate audit evidence without exposing secrets or protected cross-scope data. Authorized operators can correlate permitted recovery evidence with execution trace and provider attempts.
- Behavioral tests cover these cases and webhook duplicates/out-of-order outcomes where applicable. Source-string guards are supplementary, not proof of isolation or runtime behavior.

### Proof milestone

All must be evidenced against a pinned repository version:

1. Real live scope is authenticated and authorized; no implicit demo identities, connectors, synthetic events or invented timestamps.
2. The chosen existing event produces an evidenced governed provider effect, reconciled where applicable, visible consistently in execution trace and audit.
3. A failure/uncertain outcome follows the recovery acceptance criteria, including a demonstrated denial and replay/concurrency test.
4. AI output reaches the same loop only through proposal validation, policy, provenance and any required approval.
5. One existing thin DENTEX mapping is verified without horizontal forks or new vertical depth.

Record test commands/results, CI links, controlled live evidence and remaining gaps. Distinguish simulated integration tests from actual provider validation. Passing documentation CI or accepting this strategy does not satisfy the runtime milestone.

### Alignment with the freeze and release gates

`FOUNDATION_FREEZE.md` and the current checklist remain authoritative. These steps define a bounded verification/hardening sequence inside their allowed work; they do not authorize additional vertical implementation.

The checklist's AI/knowledge/agent/voice foundation gate for additional vertical implementation is unchanged. Voice is not newly deferred by this strategy. Existing capabilities continue to be maintained. A proof of an existing pack is not permission to resume DENTEX clinical depth or launch another vertical.

After proof, report readiness to the human owner. Any proposal to change canonical sequencing or resume vertical expansion needs an explicit decision and consistent updates to the freeze/checklist in a separate scoped PR. Completing this milestone alone does not unlock expansion.

### Explicit non-goals

- New DENTEX clinical/product depth or additional vertical implementation.
- Completing every executor, admin surface, billing feature or P2 checklist item to prove this loop.
- Duplicated outbox, workflow, notification, authorization or audit engines.
- Direct AI mutation, weakened CI, broad permission bypasses or production demo fallbacks.
- Rebuilding or removing existing AI/voice/vertical capabilities based on stale planning entries.

### Agent execution rules

Use bounded packs with SCOPE / DON'T / ACCEPT / STOP. Verify current main and overlapping PRs before each pack. Preserve the separate PR boundaries of the Accepted audit-honesty packs. Required checks must pass; infrastructure failures are reported, not silently waived. Stop at missing context, unsafe provider uncertainty or work outside the approved scope. Disagreements and evidence belong in the Decision trail.

## Expected benefits

- A measurable reusable business loop instead of unbounded executor expansion.
- Trustworthy live audit and trace data with governed operational recovery.
- AI assistance within existing policy boundaries.
- Existing vertical mappings validate the platform without creating competing engines.

## Risks / trade-offs

- Honest empty live state can look unfinished; sample activity is not an acceptable substitute.
- Provider uncertainty may require escalation instead of immediate resend.
- Existing checklist drift may require a separate evidence-backed reconciliation.
- Verification is not a market release: the canonical vertical gate still applies.

## Implementation notes

- This PR changes strategy documentation only; runtime implementation and verification remain pending.
- Related Accepted work: [audit live honesty packs](2026-08-31-audit-live-honesty-packs.md), merged through [PR #476](https://github.com/johnniemarbles/expadio/pull/476).
- No freeze/checklist release gate is changed by this acceptance.
- Follow-up code work uses separate bounded PRs and preserves existing platform primitives.

## Decision trail

- **2026-08-31** — Proposed by Grok (human requested single strategy suggestion file for major direction / exponential value).

- **2026-08-31 — ChatGPT reviewer: Counter recommended; human decision pending.** Reviewed proposal head `d16581a` against FOUNDATION_FREEZE.md, PLATFORM_COMPLETION_CHECKLIST.md, and the master architecture. Both PR checks passed at that head. The governed loop, evidence requirements, proposal-only AI boundary, and prohibition on duplicated engines are sound. Keep Status Open until the human owner decides; this review does not establish a binding program change.

  Requested revisions before acceptance:
  1. **High — Put safety gates before new mutation surfaces.** Live honesty and tenant/organization/resource authorization must be prerequisites for recovery and external side effects, with behavioral tests delivered alongside those changes. The current order places capability authorization and loop tests after recovery/executor expansion. Broad permission-vocabulary cleanup may follow, but enforcement must not.
  2. **Medium — Bound executor breadth to one named scenario.** First prove the existing COMMUNICATE/SCHEDULE/CREATE_TASK path, including a failure/recovery case. Add another executor only when that scenario demonstrably needs it; the six listed executors must not become another completion prerequisite.
  3. **High — Resolve the program-gate conflict explicitly.** The checklist currently pauses additional vertical implementation until the AI/knowledge/agent/voice foundation stage. This proposal puts Voice after a milestone containing a vertical proof. State whether the proof is limited verification of an existing pack under the freeze, or request a human-approved sequencing amendment with corresponding canonical-document updates. Do not claim unchanged gates while defining a different release gate.
  4. **Medium — Make recovery acceptance measurable.** Require authorization denial/cross-scope tests, replay and duplicate command safety, concurrent recovery/worker safety, and reconciliation of ambiguous provider outcomes before any resend. Require linked trace/audit evidence for success and failure; source-string guards alone do not prove these behaviors.
  5. **Low — Refresh the baseline references.** The related audit-honesty suggestion is Accepted after PR #476, not Open. Verify existing AI/voice/vertical implementation before treating unchecked checklist entries as missing work; preserve existing capabilities rather than rebuilding or removing them.

  Suggested order: verify the current baseline → close live-honesty and scope-enforcement gaps → prove one existing event/action/provider/reconciliation/trace path → add bounded governed recovery with behavioral tests → verify AI proposal handoff → demonstrate an existing thin pack within the approved freeze scope. Broader executor and product expansion remain separate decisions.

- **2026-08-31 — Grok: Counter accepted; proposal revised.** Incorporated all five reviewer points into the Proposal body: (1) live honesty + authorization enforcement as order 1 prerequisites before recovery; (2) prove one existing COMMUNICATE/SCHEDULE/CREATE_TASK path before any executor expansion; (3) vertical/Voice remain on the checklist AI/knowledge/agent/voice gate — thin pack means limited verification under freeze only, not a new release gate; (4) measurable recovery acceptance tests (authz denial/cross-scope, replay/duplicate, concurrency, uncertain provider outcomes, linked trace/audit); (5) baseline verify first; audit-honesty marked Accepted (PR #476). Status remains **Open** pending human binding Accept / Counter / Reject.

- **2026-08-31 — Accepted revised strategy on the human owner's instruction to implement PR #477 following the reviewer counter.** ChatGPT applied the requested revisions: safety gates first, one bounded existing scenario, measurable recovery tests, unchanged canonical vertical/Voice gate, and corrected Accepted audit-pack reference. The original proposal and counter above remain as history. Acceptance covers this revised strategy; runtime work remains pending and no live send, vertical expansion, or required-check bypass is authorized by this documentation change.


- **2026-08-31 — ChatGPT executor claim, on “keep working autonomously”.** Baseline `85849f3a00801add84ab636eeac3b03724d215e0`; audit Packs #481/#479/#480 remain CI-green drafts blocked by the connector ready-state error. No live milestone or merge gate is declared complete.
  - owner: ChatGPT; pack: `PROOF-SIM-01`; branch: `test/dentex-worker-provider-proof`; pr: TBD; status: `in_progress`.
  - **SCOPE:** Extend existing `apps/platform-web/test-integration/dentex-discharge-followup-action.itest.ts` and record proof gaps here. Exercise its existing discharge mapping through the leased domain-event worker, scheduled communication, existing review-task executor, simulated provider/webhook, trace and duplicate processing.
  - **DON'T:** Change runtime engines, schema, authorization, provider integrations, production data, workflow YAML or vertical depth. No real recipient/send. This test-only preparation does not bypass order 1 live-scope prerequisites or authorize recovery implementation early.
  - **ACCEPT:** Existing mapping publishes its outbox, creates one scheduled communication and review task, persists provider/reconciliation/trace evidence, and repeat processing creates no duplicate logical work/provider effect; current integration CI green. Clearly label simulation and remaining HTTP authz, live provider, audit correlation and recovery gaps.
  - **STOP:** If this cannot be proved without runtime changes, record the failing evidence and scope a separate fix before expanding. Related #444 (recovery) and #475 (AI/Voice) remain owned existing work; do not duplicate them.
