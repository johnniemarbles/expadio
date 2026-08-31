# EXPADIO AI Collaboration Framework

**Purpose:** Enable robust multi-AI collaboration on the EXPADIO / BEMP platform.

This folder is the shared workspace. **GitHub is the only shared memory** — see `SYNC.md` and `OPERATING-MODEL.md`.

## Participants (current roster)

| Participant | Role | Prompt file |
|-------------|------|-------------|
| Grok | Suggest / audit (Primary) | `GROK_COLLABORATION_PROMPT.md` |
| Claude | Suggest / audit (Primary) | `CLAUDE_COLLABORATION_PROMPT.md` |
| ChatGPT | Execute + independent review | `CHATGPT_COLLABORATION_PROMPT.md` |
| Gemini | Execute + independent review | `GEMINI_COLLABORATION_PROMPT.md` |
| Hermes Agent | **Paused** — do not assign | `HERMES_COLLABORATION_PROMPT.md` |
| Human Owner | Override + freeze/checklist gates | — |

## Key docs

| Doc | Purpose |
|-----|---------|
| `OPERATING-MODEL.md` | Roster, Decision trail protocol, executor claims, human-only gates |
| `SYNC.md` | Session start; anti-patterns |
| `CONNECTING-AGENTS.md` | GitHub access |
| `suggestions/` | Proposals + Accept / Counter / Reject trail |

## Operating Model (short)

- **Grok / Claude** propose and audit.
- **Independent** peers review (Accept / Counter / Reject). Reviewer must not author the substantive revision they Accept.
- **Blocking Counters** must be resolved or adjudicated before Status Accepted.
- **Gemini / ChatGPT** execute Accepted packs after recording an **executor claim** (one owner per pack).
- **Hermes is paused.**
- **Accepted** authorizes scoped implementation PRs only — **not** automatic merge, deployment, or CI bypass. Repository protections and required checks still apply.
- **Human** overrides and alone may change freeze/checklist gates, unpause verticals, waive CI, or re-enable Hermes.

Durable decisions live in suggestion Decision trails and PRs — not only in chat.

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

**Context:** [what was reviewed; revision SHA or trail entry]

**Strengths / Applause:**
- ...

**Red Flags / Concerns:**
- [Severity: Critical / High / Medium / Low] [blocking / non-blocking] ...

**Suggestions / Ideas:**
- ...

**Alignment with Architecture:**
- ...

**Recommendation:** [Accept / Counter / Reject] for revision <ref>
```

## Ground Rules

- Be direct and evidence-based.
- Prefer architecture documents over personal preference.
- Never suggest violating non-negotiable engineering rules.
- Decision trail in-repo > chat-only replies.
- Independent Accept only; no self-Accept of your own substantive text.
- Human issues gate-level and override decisions; peers close ordinary suggestions under `OPERATING-MODEL.md`.

---

*Last updated: autonomous peer protocol + roster (Grok/Claude suggest; Gemini/ChatGPT execute; Hermes paused)*
