# EXPADIO Continuous Multi-AI Operating Model

**Status:** Active  
**Active participants (current):** Grok · Claude · ChatGPT · Gemini · Human Owner  
**Paused:** Hermes Agent (until human re-enables)  
**Authority:** Human owner retains override and sole authority to amend freeze/checklist/release gates. **Day-to-day suggestion decisions (Accept / Counter / Reject) close among active reasoning AIs in the repo** so the human is not required to route every turn.

---

## Role split (current roster)

| Lane | Who | Does |
|------|-----|------|
| **Suggest / audit (Primary)** | **Grok · Claude** | Audit code/docs, open suggestions, write packs, revise on accepted counters |
| **Review** | Any active peer not sole author of the item | Accept / Counter / Reject on Decision trail with evidence |
| **Execute** | **Gemini · ChatGPT** | Implement Accepted packs via bounded PRs; report evidence on trail/PR |
| **Paused** | **Hermes** | Do not assign Executor/Memory automation to Hermes |
| **Override / gates** | **Human Owner** | Freeze, checklist gates, vertical unpause, waive required CI, production side-effect policy, roster changes |

Grok and Claude may also help execute if needed; Gemini and ChatGPT may open a suggestion if they find a gap — but the **default** split is as above. Record role on the Decision trail when non-default.

---

## Core Model

```text
Primary (Grok or Claude) audits / proposes → suggestion file on GitHub
        │
        ▼
Peer reviewer (ChatGPT, Gemini, and/or the other Primary) → Decision trail:
  Accept | Counter | Reject
        │
        ▼
If Counter → Primary responds on Decision trail:
  Accept counter (revise body) | Reject counter (rationale)
        │
        ▼
When a peer Accepts the current body:
  Status → Accepted
        │
        ▼
Executors (Gemini and/or ChatGPT) run bounded packs → PRs → evidence on trail
        │
        ▼
Human override any time; human-only for freeze, checklist gates, vertical unpause, production risk
```

Chat is not the bus. GitHub is.

---

## Autonomous Decision trail protocol (standing order)

Effective from human instruction 2026-08-31 (roster refined same day). Active agents follow without waiting for a human prompt each turn.

### 1. Propose (Grok or Claude)

- Primary writes `docs/collaboration/suggestions/YYYY-MM-DD-title.md` (structure per `suggestions/README.md`).
- Opens PR if required by repo norms; Decision trail starts with “Proposed by …”.
- Status: **Open**.

### 2. Review (peer)

- On session start, peers scan `suggestions/` for `Status: Open` and trails awaiting reply (`SYNC.md`).
- Append: **Accept** | **Counter** | **Reject** + rationale and evidence (files, tests, freeze/checklist cites).
- **Counter** lists required revisions (High/Medium/Low).

### 3. Primary response to Counter

- **Accept counter** → revise Proposal body; trail: “Counter accepted; proposal revised.” Status stays Open until a peer **Accept**s the revision (or human Accepts).
- **Reject counter** → trail rationale; Status stays Open; human may break ties.
- Do not leave Counter unanswered across sessions.

### 4. Close among peers

- After peer **Accept** on current body → set **Status: Accepted** and record who Accepted.
- **Reject** for freeze/architecture violation → **Rejected** (or Open if disputed → human).
- **Implemented** only when code/docs landed and linked (PR number).

### 5. Human-only (no autonomous Accept)

- Amend `FOUNDATION_FREEZE.md` or checklist **release / vertical / Voice gates**
- Unpause DENTEX product depth or additional verticals
- Waive red required CI for production paths
- Authorize real patient/production side effects outside controlled test policy
- Re-enable **Hermes** or change this roster

### 6. Implementation (Gemini · ChatGPT)

- Accepted suggestions → bounded packs (SCOPE / DON’T / ACCEPT / STOP), one pack per PR.
- **Gemini and ChatGPT** are the default executors. Respect pack STOP and human-only gates.
- Do **not** assign execution to Hermes while paused.

---

## Operating Rhythm

1. Pull `main` / load your prompt / read roster in this file + `SYNC.md`.
2. Scan Open suggestions and unanswered Counters.
3. Grok/Claude propose or revise; peers review; Gemini/ChatGPT execute Accepted packs.
4. Status and evidence stay in-repo — no human message-passing between agents.
5. Human overrides or settles gate-level conflicts when needed.

---

## Rules of Engagement

- **Repo is the bus.** If it is not on the Decision trail, it did not happen for the team.
- **Reviewers act without being asked** when they see Open items.
- **Primary resolves Counters in-repo** (accept/revise or reject counter).
- **Architecture and freeze docs remain source of truth.**
- **No silent scope expansion** past pack STOP or human-only gates.
- **Hermes paused** — no Executor/Memory assignments.
- **Disagreement is recorded**, not chat-only.

---

## Artefacts

| Artefact | Location | Purpose |
|----------|----------|---------|
| Shared Evaluation Template | `docs/collaboration/README.md` | Review format |
| Suggestions + Decision trail | `docs/collaboration/suggestions/` | Proposals and history |
| This operating model | `docs/collaboration/OPERATING-MODEL.md` | Rules + roster |
| Sync rules | `docs/collaboration/SYNC.md` | Session start |
| Prompts | `GROK_`, `CLAUDE_`, `CHATGPT_`, `GEMINI_COLLABORATION_PROMPT.md` | Standing orders |
| Paused | `HERMES_COLLABORATION_PROMPT.md` | Future re-enable only |

---

## Summary

- **Suggest/audit:** Grok · Claude  
- **Execute:** Gemini · ChatGPT  
- **Review:** any active peer  
- **Paused:** Hermes  
- Propose → Accept/Counter/Reject → resolve counters → Accepted packs executed in-repo  
- Human = override + gates, not the message router  

This model is now active.
