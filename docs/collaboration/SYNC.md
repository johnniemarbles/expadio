# EXPADIO Collaboration Sync Rules

**Status:** Active  
**Suggest / audit:** Grok · Claude  
**Execute:** Gemini · ChatGPT  
**Paused:** Hermes  
**Purpose:** Keep active agents and the human aligned without chat history or human message-passing between agents.

---

## Single source of truth

```text
Chat sessions are ephemeral.
GitHub (this repository) is the only shared memory.
```

| Durable | Ephemeral |
|---------|-----------|
| `docs/collaboration/**` | Model chat windows |
| Code and docs on `main` / open PRs | Uncommitted local edits |
| Suggestion Decision trails | Verbal Accept / Counter / Reject |

**Rule:** If a decision is not in the repo, it did not happen for the team.

---

## Autonomous peer decisions

See `OPERATING-MODEL.md`.

- **Grok / Claude** propose → peers Accept / Counter / Reject on the Decision trail.
- Primary accepts or rejects **Counter** on the same trail; revises body when accepting.
- **Gemini / ChatGPT** execute **Accepted** packs (bounded PRs).
- **Hermes is paused** — do not assign packs or sync automation to Hermes.
- Human-only: freeze/checklist gates, vertical unpause, waive required CI, production side effects, roster/Hermes re-enable.

Do not ask the human to relay decisions. Write the trail; the other agent pulls next session.

---

## Mandatory session start

### Grok · Claude (suggest/audit)

1. Fetch/pull `main` (or agreed branch).
2. Load `GROK_COLLABORATION_PROMPT.md` or `CLAUDE_COLLABORATION_PROMPT.md`.
3. Read `OPERATING-MODEL.md` + this file (confirm roster).
4. Scan `suggestions/` for Open items, unanswered Counters, Accepted pending pack design.
5. Propose, revise, or review as appropriate.

### Gemini · ChatGPT (execute + review)

1. Fetch/pull `main`.
2. Load `GEMINI_COLLABORATION_PROMPT.md` or `CHATGPT_COLLABORATION_PROMPT.md`.
3. Read `OPERATING-MODEL.md` + this file.
4. Scan for Open items to **review** and **Accepted** items with pending implementation.
5. Review on trail and/or execute packs within SCOPE/STOP.

### Hermes

No session obligation while paused.

---

## How work stays in sync

1. **Propose** (Grok/Claude) → `suggestions/YYYY-MM-DD-title.md`
2. **Review** → Decision trail Accept / Counter / Reject
3. **Resolve Counter** → Primary revises or rejects counter on trail
4. **Status** → Accepted / Rejected in-repo
5. **Implement** (Gemini/ChatGPT) → one pack per PR; link PR; set Implemented when done

---

## Auto checks (CI)

`.github/workflows/collaboration-sync.yml` validates suggestion structure/Status under `docs/collaboration/**`.

---

## Agent GitHub access

See `CONNECTING-AGENTS.md`. Grok, Claude, ChatGPT, and Gemini need write access for the current roster. Hermes may stay provisioned but unused.

---

## Anti-patterns

- Chat-only Accept/Counter/Reject
- Asking the human to tell the other agent
- Assigning work to **Hermes** while paused
- Executing before Status Accepted (unless human explicitly assigns)
- Leaving Counter unanswered
- Autonomous Accept of freeze/checklist gate changes

---

## Summary

**Suggest:** Grok · Claude · **Execute:** Gemini · ChatGPT · **Paused:** Hermes  
Pull → trail → packs in-repo. Human = override and gates, not the router.
