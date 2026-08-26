# EXPADIO AI Collaboration Framework

**Purpose:** Enable robust, multi-AI collaboration between **Grok**, **ChatGPT**, **Gemini**, and **Claude** (plus the human owner) on the EXPADIO / BEMP platform.

This folder is the shared workspace. All four AIs are expected to treat each other as senior engineering colleagues — not as tools or competitors.

## Participating AIs

| AI       | Prompt file                          |
|----------|--------------------------------------|
| Grok     | `GROK_COLLABORATION_PROMPT.md`       |
| ChatGPT  | `CHATGPT_COLLABORATION_PROMPT.md`    |
| Gemini   | `GEMINI_COLLABORATION_PROMPT.md`     |
| Claude   | `CLAUDE_COLLABORATION_PROMPT.md`     |

## Operating Model

**See `OPERATING-MODEL.md` for the full continuous collaboration rules.**

Short version:

- Any AI can be the **Primary Worker** on a task.
- The other three can **evaluate, raise red flags, applaud, or suggest** at any time.
- The **human owner is the sole final decision maker**.

## Goals

- Continuously evaluate code, architecture, migrations, and design decisions.
- Raise **red flags** early (security, tenancy leaks, provider coupling, vertical pollution of core, missing audit/provenance, etc.).
- Celebrate high-quality work so good patterns get reinforced.
- Propose ideas constructively.
- Maintain a transparent accept / counter / reject trail so decisions are auditable.

## How to use

1. **Start every session** by loading the relevant prompt for the AI you are talking to.
2. Load or reference `OPERATING-MODEL.md` so the continuous Primary / Reviewer rhythm is clear.
3. When evaluating work (PRs, packages, migrations, architecture docs):
   - Structure feedback using the shared evaluation template below.
   - Prefer concrete evidence (file paths, code snippets, architecture rules from `docs/architecture/`).
4. When proposing an idea:
   - Create a new file in `suggestions/` following the naming convention.
   - Any of the other AIs (and the human) can then Accept / Counter / Reject with rationale.
5. Keep the master architecture documents as the source of truth:
   - `docs/architecture/EXPADIO-MASTER-ARCHITECTURE.md`
   - Related ADRs and status docs in the same folder.

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

## Ground Rules (all four AIs)

- Be direct and evidence-based. No fluff.
- Prefer the architecture documents over personal preference.
- Never suggest violating the non-negotiable engineering rules (no direct provider SDKs from business modules, no unrestricted AI DB access, etc.).
- When in doubt, raise a red flag and propose a discussion rather than silently approving.
- Celebrate precision, test coverage, clean boundaries, and thoughtful ADRs.
- Treat the other three AIs as peers. Disagreement is welcome; competition is not.
- Follow the continuous operating model in `OPERATING-MODEL.md`.

---

*Last updated: continuous multi-AI operating model*
