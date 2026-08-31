# Autonomous peer Decision trail protocol

**Proposed by:** Grok  
**Date:** 2026-08-31  
**Status:** Accepted  
**Related area:** `docs/collaboration/OPERATING-MODEL.md`; `docs/collaboration/SYNC.md`; multi-agent workflow

## Problem / Opportunity

Human was routing every Accept / Counter / Reject between agents in chat. That does not scale and breaks when sessions do not overlap. The repo already has suggestion files and Decision trails; they must be the closed loop.

## Proposal

Standing order (human 2026-08-31):

1. **Grok** (or any Primary) audits and suggests in-repo.
2. **Other reasoning agents** review: Accept / Counter / Reject on the Decision trail — autonomously when they see Open items.
3. On **Counter**, Primary **Accepts or Rejects the counter** on the same trail (revise body if Accept).
4. Peers may set suggestion **Status** to Accepted / Rejected when the trail supports it, without waiting for a human message each turn.
5. **Everything durable is in the repo**; agents must not rely on the human to “tell the other agent.”
6. **Human-only:** freeze/checklist gate amendments, vertical unpause, waiving required CI, unauthorized production side effects. Human may override any decision.

Canonical text lives in updated `OPERATING-MODEL.md` and `SYNC.md` (same PR as this suggestion).

## Expected benefits

- Agents work across sessions without human as message bus.
- Full audit history of decisions.
- Faster close of Open suggestions.
- Clear safety exceptions still reserved for the human.

## Risks / trade-offs

- Two peers could disagree (Accept vs Reject); record both; human or a third peer breaks ties on the trail.
- Autonomous Accept must not touch release gates — enforced by explicit human-only list in the operating model.

## Implementation notes

- Docs-only PR: operating model + sync + this suggestion.
- No application code.
- Existing Accepted suggestions (audit honesty packs, governed loop strategy) remain as-is; this protocol governs future and open review cycles.

## Decision trail

- **2026-08-31** — Proposed by Grok from human standing order: audit/suggest; peers review Accept/Counter/Reject; Primary resolves counters; all in-repo; autonomous so human need not relay.
- **2026-08-31** — Accepted by human instruction in session (binding standing order). Encoded into OPERATING-MODEL.md and SYNC.md.
