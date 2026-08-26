# Suggestions Workspace

This folder holds ideas proposed by Grok, ChatGPT, Gemini, Claude, or the human. It is the durable record of collaborative thinking.

## Naming convention

```
YYYY-MM-DD-short-title.md
```

Examples:
- `2026-08-26-provider-registry-lease-hardening.md`
- `2026-08-26-workflow-gate-composition-tests.md`

## Required structure for every suggestion

```markdown
# [Title]

**Proposed by:** Grok | ChatGPT | Gemini | Claude | Human  
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
- **YYYY-MM-DD** — [Grok / ChatGPT / Gemini / Claude / Human] response: Accept / Counter / Reject — [short rationale]
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
- Update the Decision trail promptly so the other AIs and the human stay in sync.

All four AIs should periodically scan this folder at the start of a session.
