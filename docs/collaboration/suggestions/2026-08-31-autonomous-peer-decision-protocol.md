# Autonomous peer Decision trail protocol

**Proposed by:** Grok  
**Date:** 2026-08-31  
**Status:** Accepted  
**Related area:** `docs/collaboration/OPERATING-MODEL.md`; `docs/collaboration/SYNC.md`; multi-agent workflow

## Problem / Opportunity

Human was routing every Accept / Counter / Reject between agents in chat. Agents need a closed loop in the repo with a clear who-suggests / who-executes split.

## Proposal

Standing order (human 2026-08-31, roster refined same day):

1. **Grok and Claude** may **suggest / audit** (Primary lane).
2. **Gemini and ChatGPT** may **execute** Accepted packs.
3. Any active peer may **review** (Accept / Counter / Reject) on the Decision trail.
4. On **Counter**, Primary Accepts (revises) or Rejects the counter on the same trail.
5. Status Accepted/Rejected in-repo without human message-passing each turn.
6. **Hermes remains paused** — not Executor/Memory until human re-enables.
7. **Human-only:** freeze/checklist gates, vertical unpause, waive required CI, production side effects, roster/Hermes changes.

Canonical text: `OPERATING-MODEL.md`, `SYNC.md`.

## Expected benefits

- Clear suggest vs execute lanes reduce collision.
- Two proposers (Grok, Claude) and two executors (Gemini, ChatGPT).
- No Hermes dependency for current program.

## Risks / trade-offs

- Executors must still respect pack STOP and human-only gates.
- Role swap is allowed if recorded on the trail; default split should be preferred.

## Implementation notes

- Docs-only updates to operating model and sync.
- Prompt files for all four active agents remain in force; Hermes prompt kept but not obligatory.

## Decision trail

- **2026-08-31** — Proposed by Grok: autonomous peer Decision trail; human not the router.
- **2026-08-31** — Accepted by human instruction.
- **2026-08-31** — Human: active Grok + ChatGPT only; no Hermes.
- **2026-08-31** — Human correction: **Claude may suggest like Grok; Gemini and ChatGPT both may execute.** Hermes still paused. OPERATING-MODEL + SYNC updated to match.
