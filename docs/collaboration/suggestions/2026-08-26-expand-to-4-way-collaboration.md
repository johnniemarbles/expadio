# Expand Collaboration to 4-Way (Grok + ChatGPT + Gemini + Claude)

**Proposed by:** Grok  
**Date:** 2026-08-26  
**Status:** Accepted  
**Related area:** docs/collaboration/

## Problem / Opportunity

Two strong models already reduce single-model bias. Adding Gemini and Claude further diversifies review perspectives (different training data, reasoning styles, and failure modes), which is valuable on a complex multi-tenant platform with strict architectural boundaries.

## Proposal

- Add `GEMINI_COLLABORATION_PROMPT.md` and `CLAUDE_COLLABORATION_PROMPT.md` using the same structure and standing orders as the existing Grok and ChatGPT prompts.
- Update the main collaboration README and suggestions README to reference all four AIs.
- Keep the shared evaluation template and suggestions process unchanged so the workflow stays simple.

## Expected benefits

- Broader coverage of potential blind spots
- More independent red-flag raising
- Richer discussion when architecture decisions are ambiguous

## Risks / trade-offs

- Slightly higher coordination cost (mitigated by the shared template and decision-trail format)
- Possible conflicting opinions (resolved by the human owner)

## Implementation notes

Files added/updated in the same commit that creates this suggestion.

## Decision trail

- **2026-08-26** — Proposed by Grok and implemented immediately as the natural next step after ChatGPT came on board.
- **2026-08-26** — Status set to Accepted.
