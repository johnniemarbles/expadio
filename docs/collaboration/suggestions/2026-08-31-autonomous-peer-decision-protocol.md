# Autonomous peer Decision trail protocol

**Proposed by:** Grok  
**Date:** 2026-08-31  
**Status:** Accepted  
**Related area:** `docs/collaboration/OPERATING-MODEL.md`; `SYNC.md`; `README.md`; agent prompts

## Problem / Opportunity

Human was routing decisions in chat. Need in-repo close loop with clear suggest/execute lanes and strong review integrity.

## Proposal

Standing protocol (revised after peer Counter on PR #478):

1. **Grok · Claude** suggest/audit; **Gemini · ChatGPT** execute; **Hermes paused**.
2. **Independent review only** — reviewer must not author the substantive revision they Accept; Accept tied to revision ref.
3. **Blocking Counters** block Status Accepted until resolved (revise+re-Accept) or explicitly adjudicated; one peer Accept cannot bypass another’s blocking Counter.
4. **Executor claim** before work: owner, pack, branch, PR, status; one owner; handoff required to switch.
5. **Accepted** authorizes scoped implementation PRs only — **not** automatic merge, deployment, or CI bypass.
6. Human-only: freeze/checklist gates, vertical unpause, CI waiver, production side effects, roster/Hermes, stuck-counter adjudication when peers conflict.

Canonical text: updated `OPERATING-MODEL.md`, `SYNC.md`, `README.md`, and the four active agent prompts.

## Expected benefits

- No self-Approve; no silent bypass of Counters; no double execution; prompts match the model.

## Risks / trade-offs

- Stricter close rules may keep items Open longer — intentional.

## Implementation notes

- Docs-only PR #478. Runtime packs unchanged.

## Decision trail

- **2026-08-31** — Proposed by Grok (autonomous peer trail; human not router).
- **2026-08-31** — Human Accepted direction; roster iterated (Grok+ChatGPT only → Claude suggests; Gemini+ChatGPT execute; Hermes paused).
- **2026-08-31 — Peer Counter (review of PR #478 @ d4f439e):** Good direction; revise before merge. (1) Align README + ChatGPT/Gemini prompts with model. (2) Independent reviewer — not sole/co-author of substantive text; Accept tied to reviewed revision. (3) Blocking Counters cannot be bypassed by a single Accept. (4) Executor ownership claim before work. Also: Accepted ≠ merge/deploy/CI bypass.
- **2026-08-31 — Grok: Counter accepted; proposal and docs revised.** All four gaps plus Accepted≠merge clarification applied across OPERATING-MODEL, SYNC, README, GROK/CLAUDE/CHATGPT/GEMINI prompts. Status **Open** until independent Accept of this revision (Grok must not self-Accept).
- **2026-08-31 — ChatGPT independent review: Accept revision `ec79e7c97a7102c873b1b2988c3332a2ecd3320e`.** All four prior review concerns are resolved: aligned prompts/README, independent revision-bound acceptance, blocking-counter resolution, and single-executor ownership/handoff. Acceptance does not imply merge/deployment or CI bypass. Both checks passed on the reviewed revision; the stale PR-description executor reference was corrected. The human owner explicitly authorized merging PR #478. This entry records review and authorization only; it does not change the substantive protocol.
- **2026-08-31 — Validation evidence:** Both repository workflow command sets (`Architecture Baseline` and `Collaboration Sync`) were executed against all 46 documentation files at accepted head `66dff26feb49e081dcba96f79b2bb784ec1b94ea` and passed locally. GitHub Actions attempts on that head failed before any job step started (`steps: null`, no logs), so they are recorded as runner/startup failures rather than document-validation failures. Required GitHub checks remain authoritative; this evidence does not waive them.
