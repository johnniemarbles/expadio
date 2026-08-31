# EXPADIO Continuous Multi-AI Operating Model

**Status:** Active  
**Active participants (current):** Grok · ChatGPT · Human Owner  
**Paused (not in rotation until human re-enables):** Gemini · Claude · Hermes Agent  
**Authority:** Human owner retains override and sole authority to amend freeze/checklist/release gates. **Day-to-day suggestion decisions (Accept / Counter / Reject) close between Grok and ChatGPT in the repo** so the human is not required to route every turn.

---

## Core Model

```text
Primary (Grok by default) audits / proposes → suggestion file on GitHub
        │
        ▼
Peer reviewer (ChatGPT) → Decision trail:
  Accept | Counter | Reject
        │
        ▼
If Counter → Primary (Grok) responds on Decision trail:
  Accept counter (revise body) | Reject counter (rationale) | Amend
        │
        ▼
When ChatGPT Accepts (or Grok accepts counter, revises, ChatGPT re-Accepts):
  Status → Accepted
        │
        ▼
Implementation: Grok and/or ChatGPT via bounded packs/PRs
  (Hermes is paused — do not assign Executor work to Hermes)
        │
        ▼
Human override any time; human-only for freeze, checklist gates, vertical unpause, production risk
```

This is a **two-peer Decision trail** model for now. Chat is not the bus. GitHub is.

---

## Roles (current)

| Role | Who | Responsibility |
|------|-----|----------------|
| **Primary / Auditor** | Grok (default) | Audit code/docs, open suggestions, revise on accepted counters, implement or write packs |
| **Reviewer** | ChatGPT | Respond on Open suggestions via Decision trail: Accept / Counter / Reject + rationale. No chat-only decisions. |
| **Either may swap** | Grok or ChatGPT | ChatGPT may Primary a task; Grok then reviews — record roles on the trail |
| **Executor** | Grok and/or ChatGPT | Execute Accepted packs with GitHub access. **Hermes paused — not used.** |
| **Override / Gate authority** | Human Owner only | May Accept/Counter/Reject anything; sole authority to change `FOUNDATION_FREEZE`, checklist program gates, vertical unpause, or waive required checks |

Paused participants (Gemini, Claude, Hermes) keep their prompt files for a future re-enable; they are **out of session-start obligations** until the human restores them on this document’s Decision-equivalent note or a new suggestion.

---

## Autonomous Decision trail protocol (standing order)

Effective from human instruction 2026-08-31. Grok and ChatGPT follow without waiting for a human prompt each turn.

### 1. Propose

- Primary writes `docs/collaboration/suggestions/YYYY-MM-DD-title.md` (structure per `suggestions/README.md`).
- Opens PR if required by repo norms; Decision trail starts with “Proposed by …”.
- Status: **Open**.

### 2. Review (ChatGPT when Grok proposed, or reverse)

- On session start, the peer scans `suggestions/` for `Status: Open` and trails awaiting reply (`SYNC.md`).
- Append Decision trail entry: **Accept** | **Counter** | **Reject** with concrete rationale and evidence (files, tests, freeze/checklist cites).
- **Counter** must list required revisions (High/Medium/Low) so Primary can act without a meeting.

### 3. Primary response to Counter

Within the same suggestion file (and PR branch if open):

- **Accept counter** → revise Proposal body to incorporate points; Decision trail: “Counter accepted; proposal revised.” Status stays Open until the peer **Accept**s the revision (or human Accepts).
- **Reject counter** → Decision trail rationale citing freeze/architecture; Status stays Open; human may break ties.
- Do not leave Counter unanswered across sessions.

### 4. Close between peers

- After peer **Accept** on current body → Primary or Reviewer sets **Status: Accepted** and records who Accepted.
- **Reject** by peer with architecture/freeze violation → Status **Rejected** (or remains Open if Primary disputes and human tie-break needed).
- **Implemented** only when code/docs landed and linked (PR number).

### 5. What stays human-only (no autonomous Accept)

Agents must **not** autonomously Accept changes that:

- Amend `FOUNDATION_FREEZE.md` or checklist **release / vertical / Voice gates**
- Unpause DENTEX product depth or additional verticals
- Waive red required CI for production paths
- Authorize real patient/production side effects outside controlled test policy
- Re-enable Hermes / Gemini / Claude as active participants (human updates this model)

Those require explicit human Decision trail or human-authored canonical doc PR.

### 6. Implementation

- Accepted suggestions → bounded packs (SCOPE / DON’T / ACCEPT / STOP), one pack per PR.
- **Grok or ChatGPT** execute Accepted packs (not Hermes). Still respect pack STOP and human-only gates above.

---

## Operating Rhythm

1. Pull `main` / load prompts / scan Open suggestions (`SYNC.md`).
2. Primary proposes or continues audit in-repo.
3. Peer reviews via Decision trail (autonomous).
4. Primary resolves counters in-repo (autonomous).
5. Status → Accepted / Rejected without waiting for human routing.
6. Grok/ChatGPT implement Accepted packs; report evidence in trail or PR.
7. Human overrides or settles gate-level conflicts when needed.

---

## Rules of Engagement

- **Repo is the bus.** If it is not in the Decision trail, it did not happen for the team.
- **Reviewer acts without being asked** when they see Open items.
- **Primary does not wait for human** to accept a peer Counter that improves safety/alignment; revise or reject counter in-repo.
- **Architecture and freeze docs remain source of truth.**
- **No silent scope expansion** past pack STOP or human-only gates.
- **Do not assign work to Hermes** while paused.
- **Disagreement is recorded**, not smoothed in chat only.
- **Celebrate good work** on the trail when reviews catch real issues.

---

## Artefacts

| Artefact | Location | Purpose |
|----------|----------|---------|
| Shared Evaluation Template | `docs/collaboration/README.md` | Standard format for reviews |
| Suggestions + Decision trail | `docs/collaboration/suggestions/` | Durable proposals and Accept/Counter/Reject history |
| This operating model | `docs/collaboration/OPERATING-MODEL.md` | Collaboration rules including active roster |
| Sync rules | `docs/collaboration/SYNC.md` | Session start and anti-patterns |
| Active prompts | `GROK_COLLABORATION_PROMPT.md`, `CHATGPT_COLLABORATION_PROMPT.md` | Standing orders for active peers |
| Paused prompts | `GEMINI_`, `CLAUDE_`, `HERMES_COLLABORATION_PROMPT.md` | Kept for future re-enable; not obligatory session load |

---

## Summary

- **Active:** Grok + ChatGPT (+ human override/gates).
- **Paused:** Gemini, Claude, Hermes.
- Propose → peer Accept/Counter/Reject → resolve counters → Status in-repo → packs by Grok/ChatGPT.
- Human is not the message router; human remains override and gate authority.

This model is now active.
