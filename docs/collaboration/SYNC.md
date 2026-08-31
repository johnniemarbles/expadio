# EXPADIO Collaboration Sync Rules

**Status:** Active  
**Purpose:** Keep Grok, ChatGPT, Gemini, Claude, Hermes, and the human aligned without relying on chat history or human message-passing between agents.

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
| PR discussion linked from a suggestion | Side conversations with no file update |

**Rule:** If a decision is not in the repo, it did not happen for the team.

---

## Autonomous peer decisions (standing order)

See `OPERATING-MODEL.md` § Autonomous Decision trail protocol.

- Primary proposes → Reviewer Accept / Counter / Reject on the **Decision trail**.
- Primary accepts or rejects **Counter** on the same trail and revises the body when accepting.
- Peers may set **Status: Accepted** or **Rejected** when the trail supports it — **without waiting for a human prompt each turn**.
- Human-only exceptions: freeze/checklist gate amendments, vertical unpause, waiving required CI, unauthorized production side effects.

Agents must not ask the human to “tell the other agent” what was decided. Write the trail; the other agent pulls it next session.

---

## Mandatory session start (all agents)

1. `git fetch origin` and update to current `main` (or the agreed working branch).
2. Load your role prompt under `docs/collaboration/`.
3. Read `OPERATING-MODEL.md` and this file (`SYNC.md`).
4. Scan `suggestions/` for:
   - `Status: Open` items
   - Decision trails awaiting **your** reply (Counter without Primary response, Open without peer review)
   - `Status: Accepted` with implementation still pending (packs to run if you are Executor/Primary)
5. Only then start new work.

Stale clones are a process failure.

---

## How work stays in sync

1. **Propose** → new file in `suggestions/` (naming + structure per `suggestions/README.md`).
2. **Respond** → Append to that file’s **Decision trail** (Accept / Counter / Reject + short rationale). Do not counter only in chat.
3. **Resolve Counter** → Primary revises body and trails “Counter accepted; proposal revised,” or rejects counter with rationale.
4. **Peer or Primary closes** → `Status` Accepted / Rejected when protocol allows (see operating model). Human may always override.
5. **Implement** → Via PR for code; when merged, set suggestion to `Implemented` and link the PR.
6. **Hermes** may maintain artefacts, run sync reports, execute Accepted packs, and push scoped file updates when assigned or when protocol authorizes Executor work.

---

## Auto checks (CI)

Workflow: `.github/workflows/collaboration-sync.yml`

On changes under `docs/collaboration/**` it validates that suggestion files (except `README.md`) include required sections and a valid Status line.

Fix CI failures before treating collaboration docs as settled.

---

## Agent GitHub access

See `CONNECTING-AGENTS.md` for how each participant connects to this repository.

Minimum bar for any agent that writes:

- Authenticated git or GitHub CLI/API access to `johnniemarbles/expadio`
- Ability to pull before write and push (or open PR) after write
- Respect branch and review norms set by the human

---

## Hermes sync report (on demand or scheduled)

When asked for a sync report, Hermes should:

1. Pull latest `main`.
2. List all `suggestions/*.md` with Status Open / Countered / Accepted (pending implementation).
3. Flag Decision trails that only contain the proposer (no peer response) older than one review cycle.
4. Flag Counters with no Primary response.
5. Flag any prompt/operating-model drift (missing files, broken links).
6. Report paths + one-line status; do not invent Accept/Reject on behalf of reasoning peers unless executing an explicit assignment.

---

## Anti-patterns

- Accepting or rejecting only in a chat window
- Asking the human to relay a decision to another agent instead of writing the Decision trail
- Editing collaboration docs without pull first
- Long parallel debates with no suggestion file
- Leaving Counter unanswered
- Treating fixture UI or local branches as team state
- Hermes acting as a fifth architecture peer instead of Executor/Memory
- Autonomous Accept of freeze/checklist gate changes or vertical unpause

---

## Summary

Pull → read collaboration folder → write durable artefacts → peer Decision trail (Accept/Counter/Reject) → Primary resolves counters → Status in-repo → packs/PRs for implementation.  
GitHub is the bus. Everything else is a client. Human is override and gate authority, not the message router.
