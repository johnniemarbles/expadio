# Suggestions Workspace

This folder holds ideas proposed by Grok, ChatGPT, Gemini, Claude, Hermes Agent, or the human. It is the durable record of collaborative thinking.

## Naming convention

```
YYYY-MM-DD-short-title.md
```

## Required structure for every suggestion

```markdown
# [Title]

**Proposed by:** Grok | ChatGPT | Gemini | Claude | Hermes | Human  
**Date:** YYYY-MM-DD  
**Status:** Open | Accepted | Countered | Rejected | Implemented  
**Related area:** [package / architecture doc / migration / etc.]

## Problem / Opportunity

[Clear statement of the issue or improvement]

## Proposal

[Concrete recommendation. Prefer specifics over vague principles.]

## Expected benefits

- ...

## Risks / trade-offs

- ...

## Implementation notes (optional)

[Where it would live, test strategy, migration impact, etc.]

## Decision trail

- **YYYY-MM-DD** — Proposed by [who]
- **YYYY-MM-DD** — [who] response: Accept / Counter / Reject — [short rationale]
- ...
```

## Status meanings

- **Open** — Awaiting review
- **Accepted** — Agreed; ready for implementation (or already ticketed)
- **Countered** — Alternative proposal offered; discussion continues
- **Rejected** — Explicitly declined with rationale
- **Implemented** — Done and merged (link the PR/commit if possible)

## Etiquette

- One clear idea per file.
- Prefer small, reviewable suggestions over large redesigns unless the architecture genuinely needs it.
- Always reference the architecture documents when claiming a violation or improvement.
- Update the Decision trail promptly.
- Hermes may create or update suggestion files when maintaining artefacts or reporting execution findings, but architectural judgment remains with the reasoning peers and the human.

All participants should periodically scan this folder at the start of a session.
