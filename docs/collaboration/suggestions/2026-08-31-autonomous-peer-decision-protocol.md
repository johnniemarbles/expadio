# Autonomous peer Decision trail protocol

**Proposed by:** Grok  
**Date:** 2026-08-31  
**Status:** Accepted  
**Related area:** `docs/collaboration/OPERATING-MODEL.md`; `docs/collaboration/SYNC.md`; multi-agent workflow

## Problem / Opportunity

Human was routing every Accept / Counter / Reject between agents in chat. That does not scale and breaks when sessions do not overlap. The repo already has suggestion files and Decision trails; they must be the closed loop.

## Proposal

Standing order (human 2026-08-31):

1. **Grok** audits and suggests in-repo (default Primary).
2. **ChatGPT** reviews: Accept / Counter / Reject on the Decision trail — autonomously when Open items appear.
3. On **Counter**, Grok **Accepts or Rejects the counter** on the same trail (revise body if Accept).
4. Either peer may set suggestion **Status** to Accepted / Rejected when the trail supports it, without waiting for a human message each turn.
5. **Everything durable is in the repo**; agents must not rely on the human to “tell the other agent.”
6. **Active roster: Grok + ChatGPT only.** Gemini, Claude, and **Hermes are paused** until the human re-enables them in `OPERATING-MODEL.md`.
7. **Implementation** of Accepted packs: Grok and/or ChatGPT (not Hermes).
8. **Human-only:** freeze/checklist gate amendments, vertical unpause, waiving required CI, unauthorized production side effects, changing the active agent roster.

Canonical text lives in `OPERATING-MODEL.md` and `SYNC.md`.

## Expected benefits

- Two-agent loop without human as message bus.
- Full audit history of decisions.
- No dependency on Hermes for current execution.

## Risks / trade-offs

- Only one reviewer (ChatGPT) — ties go to human.
- No Hermes automation until re-enabled; pack execution is manual by Grok/ChatGPT sessions.

## Implementation notes

- Docs-only; encoded in operating model + sync.
- Re-enable Hermes/Gemini/Claude only via human-directed update to `OPERATING-MODEL.md`.

## Decision trail

- **2026-08-31** — Proposed by Grok from human standing order: audit/suggest; peers review Accept/Counter/Reject; Primary resolves counters; all in-repo; autonomous so human need not relay.
- **2026-08-31** — Accepted by human instruction in session (binding standing order). Encoded into OPERATING-MODEL.md and SYNC.md.
- **2026-08-31** — Human narrowed active roster: **Grok + ChatGPT only; no Hermes for now.** Gemini and Claude also paused. OPERATING-MODEL and SYNC updated; implementation and review obligations apply only to Grok and ChatGPT.
