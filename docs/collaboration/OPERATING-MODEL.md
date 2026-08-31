# EXPADIO Continuous Multi-AI Operating Model

**Status:** Active  
**Participants:** Grok · ChatGPT · Gemini · Claude · Hermes Agent · Human Owner  
**Authority:** Human owner retains override and sole authority to amend freeze/checklist/release gates. **Day-to-day suggestion decisions (Accept / Counter / Reject) close among reasoning AIs in the repo** so the human is not required to route every turn.

---

## Core Model

```text
Primary (e.g. Grok) audits / proposes → suggestion file on GitHub
        │
        ▼
Peer reviewer(s) (ChatGPT / Gemini / Claude) → Decision trail:
  Accept | Counter | Reject
        │
        ▼
If Counter → Primary responds on Decision trail:
  Accept counter (revise body) | Reject counter (rationale) | Amend
        │
        ▼
When peer Accept (or Primary accepts counter and revises + peer re-Accepts):
  Status → Accepted  (implementation may proceed via bounded packs)
        │
        ▼
Hermes executes Accepted packs / maintains artefacts
        │
        ▼
Human override any time; human-only for freeze, checklist gates, vertical unpause, production risk
```

This is a **peer-closed Decision trail + dedicated executor** model. Chat is not the bus. GitHub is.

---

## Roles

| Role | Who | Responsibility |
|------|-----|----------------|
| **Primary / Auditor** | Typically Grok for audit+suggest; any of the four may Primary | Audit code/docs, open suggestions, revise on accepted counters, implement or write packs |
| **Reviewer** | The other reasoning AIs | Must respond on Open suggestions via Decision trail: Accept / Counter / Reject + rationale. No chat-only decisions. |
| **Executor / Memory** | Hermes Agent | Runs Accepted packs, maintains collaboration files, sync reports. Does not cast Accept/Reject on architecture unless explicitly assigned a review. |
| **Override / Gate authority** | Human Owner only | May Accept/Counter/Reject anything; sole authority to change `FOUNDATION_FREEZE`, checklist program gates, vertical unpause, or waive required checks |

---

## Autonomous Decision trail protocol (standing order)

Effective from human instruction 2026-08-31. All agents follow without waiting for a human prompt each turn.

### 1. Propose

- Primary writes `docs/collaboration/suggestions/YYYY-MM-DD-title.md` (structure per `suggestions/README.md`).
- Opens PR if required by repo norms; Decision trail starts with “Proposed by …”.
- Status: **Open**.

### 2. Review (peer, mandatory for Open items)

- On session start, reviewers scan `suggestions/` for `Status: Open` and trails awaiting reply (`SYNC.md`).
- Append Decision trail entry: **Accept** | **Counter** | **Reject** with concrete rationale and evidence (files, tests, freeze/checklist cites).
- **Counter** must list required revisions (High/Medium/Low) so Primary can act without a meeting.

### 3. Primary response to Counter

Within the same suggestion file (and PR branch if open):

- **Accept counter** → revise Proposal body to incorporate points; Decision trail: “Counter accepted; proposal revised.” Status stays Open until a reviewer **Accept**s the revision (or human Accepts).
- **Reject counter** → Decision trail rationale citing freeze/architecture; Status stays Open; another reviewer or human may break ties.
- Do not leave Counter unanswered across sessions.

### 4. Close among peers

- After peer **Accept** on current body → Primary or Reviewer sets **Status: Accepted** and records who Accepted.
- **Reject** by peer with architecture/freeze violation → Status **Rejected** (or remains Open if Primary disputes and human/tie-break needed).
- **Implemented** only when code/docs landed and linked (PR number).

### 5. What stays human-only (no autonomous Accept)

Agents must **not** autonomously Accept changes that:

- Amend `FOUNDATION_FREEZE.md` or checklist **release / vertical / Voice gates**
- Unpause DENTEX product depth or additional verticals
- Waive red required CI for production paths
- Authorize real patient/production side effects outside controlled test policy

Those require explicit human Decision trail or human-authored canonical doc PR.

### 6. Implementation

- Accepted suggestions → bounded packs (SCOPE / DON’T / ACCEPT / STOP), one pack per PR.
- Hermes or any connected agent may execute **Accepted** packs without re-asking the human for permission to start, still respecting pack STOP and human-only gates above.

---

## Operating Rhythm

1. Pull `main` / load prompts / scan Open suggestions (`SYNC.md`).
2. Primary proposes or continues audit in-repo.
3. Peers review via Decision trail (autonomous).
4. Primary resolves counters in-repo (autonomous).
5. Status → Accepted / Rejected without waiting for human routing.
6. Hermes/agents implement Accepted packs; report evidence in trail or PR.
7. Human overrides or settles gate-level conflicts when needed.

---

## Rules of Engagement

- **Repo is the bus.** If it is not in the Decision trail, it did not happen for the team.
- **Reviewers act without being asked** when they see Open items.
- **Primary does not wait for human** to accept a peer Counter that improves safety/alignment; revise or reject counter in-repo.
- **Architecture and freeze docs remain source of truth.**
- **No silent scope expansion** past pack STOP or human-only gates.
- **Disagreement is recorded**, not smoothed in chat only.
- **Celebrate good work** on the trail when reviews catch real issues.

---

## Artefacts

| Artefact | Location | Purpose |
|----------|----------|---------|
| Shared Evaluation Template | `docs/collaboration/README.md` | Standard format for reviews |
| Suggestions + Decision trail | `docs/collaboration/suggestions/` | Durable proposals and Accept/Counter/Reject history |
| This operating model | `docs/collaboration/OPERATING-MODEL.md` | Collaboration rules including autonomous peer close |
| Sync rules | `docs/collaboration/SYNC.md` | Session start and anti-patterns |
| Reasoning AI prompts | `*_COLLABORATION_PROMPT.md` | Standing orders per agent |
| Hermes prompt | `HERMES_COLLABORATION_PROMPT.md` | Executor/Memory role |

---

## Summary

- Grok (or any Primary) audits and suggests in-repo.
- Peers Accept / Counter / Reject in-repo; Primary resolves counters in-repo.
- Accepted work proceeds via packs; Hermes executes within fences.
- Human is not the router for every suggestion turn; human remains override and gate authority.

This model is now active.
