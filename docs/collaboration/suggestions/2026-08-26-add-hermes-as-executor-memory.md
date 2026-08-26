# Add Hermes Agent as Executor / Persistent Memory / Automation

**Proposed by:** Grok  
**Date:** 2026-08-26  
**Status:** Accepted  
**Related area:** docs/collaboration/

## Problem / Opportunity

The four reasoning AIs (Grok, ChatGPT, Gemini, Claude) provide strong multi-perspective review. The collaboration still lacks a durable executor and long-lived memory that can maintain artefacts, run scoped operational tasks, and accumulate EXPADIO-specific knowledge across sessions.

Hermes Agent (Nous Research) is purpose-built for persistent memory, skill learning, and autonomous execution. Adding it as a distinct role (not a fifth peer reviewer) strengthens the system without blurring judgment authority.

## Proposal

- Add `HERMES_COLLABORATION_PROMPT.md` with a strict Executor / Memory / Automation role.
- Update `OPERATING-MODEL.md` and the main collaboration README to reflect the role separation.
- Hermes may execute scoped tasks, maintain `docs/collaboration/` artefacts, and surface observations found during execution.
- Hermes does **not** hold architectural authority and is not treated as an equal peer reviewer.

## Expected benefits

- Continuity of project knowledge across sessions
- Faster execution of mechanical follow-ups (file updates, checks, summaries)
- Clean separation between judgment (4 reasoning AIs + human) and execution/memory (Hermes)

## Risks / trade-offs

- Role confusion if Hermes is treated like a fifth peer → mitigated by explicit prompt and operating-model language
- Autonomy drift → mitigated by human-final-authority rule and scoped-task discipline

## Implementation notes

Files updated/created in the same change that records this suggestion.

## Decision trail

- **2026-08-26** — Proposed by Grok; human agreed with the scoped-role approach.
- **2026-08-26** — Status set to Accepted and implemented.
