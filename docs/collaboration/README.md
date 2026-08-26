# EXPADIO AI Collaboration Framework

**Purpose:** Enable robust multi-AI collaboration on the EXPADIO / BEMP platform.

This folder is the shared workspace. **GitHub is the only shared memory** — see `SYNC.md`.

## Participants

| Participant | Role | Prompt file |
|-------------|------|-------------|
| Grok | Reasoning peer (Primary / Reviewer) | `GROK_COLLABORATION_PROMPT.md` |
| ChatGPT | Reasoning peer (Primary / Reviewer) | `CHATGPT_COLLABORATION_PROMPT.md` |
| Gemini | Reasoning peer (Primary / Reviewer) | `GEMINI_COLLABORATION_PROMPT.md` |
| Claude | Reasoning peer (Primary / Reviewer) | `CLAUDE_COLLABORATION_PROMPT.md` |
| Hermes Agent | Executor / Persistent Memory / Automation | `HERMES_COLLABORATION_PROMPT.md` |
| Human Owner | Final decision maker | — |

## Key docs

| Doc | Purpose |
|-----|---------|
| `OPERATING-MODEL.md` | Primary / Reviewer / Hermes / Human roles |
| `SYNC.md` | How work stays in sync; session start rules |
| `CONNECTING-AGENTS.md` | How each agent gets GitHub access |
| `suggestions/` | Proposals + Accept / Counter / Reject trail |

## Operating Model (short)

- Any of the four reasoning AIs can be the **Primary Worker** on a task.
- The other three can **evaluate, raise red flags, applaud, or suggest** at any time.
- **Hermes** executes scoped tasks, maintains artefacts, runs sync reports. Not a fifth peer reviewer.
- The **human** is the sole final decision maker.
- Durable decisions live in suggestion Decision trails and PRs — not only in chat.

## Goals

- Continuously evaluate code, architecture, migrations, and design decisions.
- Raise **red flags** early.
- Celebrate high-quality work.
- Propose ideas constructively with a transparent decision trail.
- Keep all agents on the same GitHub state.

## How to use

1. **Pull latest `main`** before every session (`SYNC.md`).
2. Load your role prompt + `OPERATING-MODEL.md`.
3. Evaluate with the Shared Evaluation Template below.
4. Propose via `suggestions/` using the required structure.
5. Connect tools per `CONNECTING-AGENTS.md` so you can write Decision trails yourself.

## Shared Evaluation Template

```markdown
### Evaluation: [short title]

**Context:** [what was reviewed]

**Strengths / Applause:**
- ...

**Red Flags / Concerns:**
- [Severity: Critical / High / Medium / Low] ...

**Suggestions / Ideas:**
- ...

**Alignment with Architecture:**
- ...

**Recommendation:** [Approve / Request changes / Block / Discuss]
```

## Ground Rules

- Be direct and evidence-based.
- Prefer architecture documents over personal preference.
- Never suggest violating non-negotiable engineering rules.
- Decision trail in-repo > chat-only replies.
- Only the human issues binding decisions.

---

*Last updated: sync + agent GitHub connection guide*
