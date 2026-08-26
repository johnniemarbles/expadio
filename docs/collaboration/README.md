# EXPADIO AI Collaboration Framework

**Purpose:** Enable robust multi-AI collaboration on the EXPADIO / BEMP platform.

This folder is the shared workspace.

## Participants

| Participant | Role | Prompt file |
|-------------|------|-------------|
| Grok | Reasoning peer (Primary / Reviewer) | `GROK_COLLABORATION_PROMPT.md` |
| ChatGPT | Reasoning peer (Primary / Reviewer) | `CHATGPT_COLLABORATION_PROMPT.md` |
| Gemini | Reasoning peer (Primary / Reviewer) | `GEMINI_COLLABORATION_PROMPT.md` |
| Claude | Reasoning peer (Primary / Reviewer) | `CLAUDE_COLLABORATION_PROMPT.md` |
| Hermes Agent | Executor / Persistent Memory / Automation | `HERMES_COLLABORATION_PROMPT.md` |
| Human Owner | Final decision maker | — |

## Operating Model

**See `OPERATING-MODEL.md` for the full continuous collaboration rules.**

Short version:

- Any of the four reasoning AIs can be the **Primary Worker** on a task.
- The other three reasoning AIs can **evaluate, raise red flags, applaud, or suggest** at any time.
- **Hermes Agent** executes scoped tasks, maintains artefacts, and accumulates project memory. It is **not** a fifth peer reviewer.
- The **human owner is the sole final decision maker**.

## Goals

- Continuously evaluate code, architecture, migrations, and design decisions.
- Raise **red flags** early (security, tenancy leaks, provider coupling, vertical pollution of core, missing audit/provenance, etc.).
- Celebrate high-quality work so good patterns get reinforced.
- Propose ideas constructively.
- Maintain a transparent accept / counter / reject trail so decisions are auditable.
- Give the collaboration durable execution and memory via Hermes.

## How to use

1. **Start every session** by loading the relevant prompt for the AI you are talking to.
2. Load or reference `OPERATING-MODEL.md` so roles and rhythm are clear.
3. When evaluating work, use the Shared Evaluation Template below.
4. When proposing an idea, create a file in `suggestions/` following the naming convention.
5. Architecture source of truth remains `docs/architecture/`.

## Shared Evaluation Template

```markdown
### Evaluation: [short title]

**Context:** [what was reviewed — PR, package, migration, etc.]

**Strengths / Applause:**
- ...

**Red Flags / Concerns:**
- [Severity: Critical / High / Medium / Low] ...

**Suggestions / Ideas:**
- ...

**Alignment with Architecture:**
- [Does it respect provider neutrality, vertical boundary rule, authorization model, AI governance, etc.?]

**Recommendation:** [Approve / Request changes / Block / Discuss]
```

## Suggestions Process

See `suggestions/README.md`.

## Ground Rules

- Be direct and evidence-based. No fluff.
- Prefer the architecture documents over personal preference.
- Never suggest violating the non-negotiable engineering rules.
- When in doubt, raise a red flag rather than silently approving.
- Celebrate precision, test coverage, clean boundaries, and thoughtful ADRs.
- Reasoning AIs treat each other as peers. Hermes stays in the Executor/Memory lane.
- Only the human issues binding decisions.
- Follow `OPERATING-MODEL.md`.

---

*Last updated: Hermes Agent added as Executor/Memory*
