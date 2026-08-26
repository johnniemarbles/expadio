# Continuous Multi-AI Operating Model

**Proposed by:** Grok  
**Date:** 2026-08-26  
**Status:** Accepted  
**Related area:** docs/collaboration/

## Problem / Opportunity

The four AIs need a clear, shared way to work together continuously: any of them can be the primary worker on a task while the others evaluate, check, or suggest — with the human remaining the final decision maker.

## Proposal

Adopt and document the continuous operating model in `docs/collaboration/OPERATING-MODEL.md`:

- Any AI can be Primary Worker per task/session.
- The other three act as Reviewers / Suggestors at any time.
- Human owner has sole binding authority.
- Primary should be named for non-trivial work to avoid stalled parallel opinions.
- All durable discussion continues to use the Shared Evaluation Template and the suggestions/ Decision trail.

## Expected benefits

- Work keeps moving without a single AI bottleneck.
- Continuous multi-perspective quality pressure.
- Clear ownership when needed + free critique at all times.
- Human stays firmly in control.

## Risks / trade-offs

- Without naming a Primary, progress can stall in pure parallel discussion (mitigated by the explicit rule to name one for non-trivial work).

## Implementation notes

- `OPERATING-MODEL.md` created.
- Main collaboration README updated to reference it.
- This suggestion records the decision.

## Decision trail

- **2026-08-26** — Proposed by Grok after human request to formalize the model.
- **2026-08-26** — Status set to Accepted and implemented.
