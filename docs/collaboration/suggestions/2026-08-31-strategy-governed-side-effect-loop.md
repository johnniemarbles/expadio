# Strategy: Governed side-effect loop first (then multiply)

**Proposed by:** Grok  
**Date:** 2026-08-31  
**Status:** Open  
**Related area:** Platform program strategy; `docs/platform/FOUNDATION_FREEZE.md`; `docs/platform/PLATFORM_COMPLETION_CHECKLIST.md`; `docs/architecture/EXPADIO-MASTER-ARCHITECTURE.md`; agent task prioritization

## Problem / Opportunity

The horizontal execution foundation is frozen and largely built (tenancy/RLS, Decision Fabric, outbox, Action Fabric with COMMUNICATE / SCHEDULE / CREATE_TASK, communication delivery + webhooks, execution/health surfaces). Vertical product depth is correctly paused.

Risk: treating “platform completion” as an unbounded checklist (recovery, every executor, knowledge, AI, agent, voice, billing, admin, security) without a single compounding north star. Linear checklist progress does not guarantee exponential product value. Demo/synthetic live paths (e.g. Audit honesty gaps) further erode trust in the spine we are trying to productize.

Opportunity: lock one major direction so every reasoning AI and Hermes prioritizes work that multiplies — not more engines, not early vertical depth, not AI that mutates business state.

## Proposal

**Major direction (binding intent if Accepted):**

> Make the frozen execution spine a **closed, live-honest product loop**, then multiply through **thin vertical packs**. Do not lead with new engines, second verticals, or unconstrained AI.

### North-star loop

```text
Domain event
  → Decision / Governed Action
  → Executor
  → Provider side effect + evidence
  → Webhook reconciliation (where applicable)
  → Execution trace + Audit
  → Failure only via governed recovery commands
```

AI / agents may only emit proposals/drafts into that loop. No direct business table mutation.

### Priority sequence (agent and human program order)

| Order | Focus | Notes |
|-------|--------|--------|
| **1** | Governed recovery + Action Fabric breadth | Recovery command model/API/UI; executors: `ASSIGN`, `REQUEST_APPROVAL`, `WEBHOOK`, `START_WORKFLOW`, `ADVANCE_WORKFLOW`, `CREATE_DOCUMENT` as needed for a real ops loop |
| **2** | Live honesty / no production demo fallbacks | Includes audit activity context, no synthetic events, empty-state copy; source-contract guards against demo tenant/org/connector fallbacks |
| **3** | Capability-level auth + CI/E2E on the loop | `platform.execution.*` (and related) vocabulary; event→action→provider→webhook→trace harnesses |
| **4** | AI as proposal-only → Action Fabric | Knowledge + AI Gateway foundations only with proposal handoff and provenance; enforce no direct AI mutation |
| **5** | One thin vertical pack on the frozen spine | e.g. DENTEX as ontology + workflows + templates + UI modules — zero forked communication/workflow/auth/audit engines |
| **Later** | Voice, embedded SDK, Platform Admin depth, billing/usage, more verticals | After north-star milestone below |

### North-star milestone (“exponential unlocked”)

All must be true:

1. Real tenant, **live** mode, no hard-coded demo tenant/org in production paths.
2. A domain event yields governed action → provider side effect → reconciliation → visible on **execution trace and audit**.
3. Operational failure is repaired only via **governed recovery** commands with audit/trace evidence.
4. AI may propose the next action; it **never** writes business state directly.
5. **One** vertical pack runs on that path without forking horizontal primitives.

### Explicit non-goals until milestone

- Second vertical product depth (WeRealtors, Nordrux, insurance, LMS, community, jobs, marketplace, mobile depth).
- DENTEX clinical/product-depth beyond what is required to prove the pack pattern after steps 1–4.
- New duplicate engines (second outbox, second workflow, second notification stack, etc.).
- AI/agent features that bypass Action Fabric.
- Treating full checklist completion as the goal instead of the loop + one pack proof.

### Alignment with existing freeze

This does **not** replace `FOUNDATION_FREEZE.md`. It **narrows execution order** inside the allowed platform-only program so agent packs and PRs optimize for compounding leverage. Checklist items remain valid; sequencing and “done enough to multiply” are defined by the north-star milestone.

### How other agents should use this

- Before opening a large PR or suggestion: ask whether it advances order 1→5 or only expands surface area.
- Prefer small packs with SCOPE / DON’T / ACCEPT / STOP (see audit live honesty packs).
- Hermes executes only Accepted or explicitly assigned packs inside this sequence.
- Disagreement belongs in this file’s Decision trail, not silent scope expansion.

## Expected benefits

- Every hour compounds on a reusable loop instead of parallel incomplete surfaces.
- Enterprise trust: live audit/trace match reality; recovery is governed.
- Vertical multiplication becomes configuration + ontology + templates, not platform rewrites.
- AI differentiation stays safe and architectural (proposal → policy → action).
- Clear stop rules for agents reduce collocation drift and checklist thrash.

## Risks / trade-offs

- Live empty timelines and strict no-fallback behaviour can look “unfinished” until real events exist — prefer honesty over synthetic completeness.
- Delaying vertical product marketing until the milestone may feel slow; premature vertical depth is more expensive long-term.
- Action Fabric breadth and recovery are non-trivial; still cheaper than forked per-vertical ops.
- Over-interpreting “platform first” as “finish all P2 items first” remains a risk — mitigate by enforcing the north-star milestone as the gate to vertical multiplication.

## Implementation notes

- **This file only** — strategy suggestion; no application code.
- Related Open work: `docs/collaboration/suggestions/2026-08-31-audit-live-honesty-packs.md` (order 2 slice).
- After **Accept**: update Decision trail; optionally add a one-line pointer from `PLATFORM_COMPLETION_CHECKLIST.md` “Current strategy” to this suggestion (separate tiny docs PR).
- Do not weaken freeze rules; do not unpause vertical depth in the same PR as Accept without human explicit override.

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
