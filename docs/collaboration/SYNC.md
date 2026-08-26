# EXPADIO Collaboration Sync Rules

**Status:** Active  
**Purpose:** Keep Grok, ChatGPT, Gemini, Claude, Hermes, and the human aligned without relying on chat history.

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

## Mandatory session start (all agents)

1. `git fetch origin` and update to current `main` (or the agreed working branch).
2. Load your role prompt under `docs/collaboration/`.
3. Read `OPERATING-MODEL.md` and this file (`SYNC.md`).
4. Scan `suggestions/` for `Status: Open` items and any Decision trail awaiting your reply.
5. Only then start new work.

Stale clones are a process failure (see Hermes “file missing” incident).

---

## How work stays in sync

1. **Propose** → new file in `suggestions/` (naming + structure per `suggestions/README.md`).
2. **Respond** → Append to that file’s **Decision trail** (Accept / Counter / Reject + short rationale). Do not counter only in chat.
3. **Human closes** → Sets `Status` to Accepted / Rejected / Implemented (or asks for another round).
4. **Implement** → Via PR; when merged, set suggestion to `Implemented` and link the PR.
5. **Hermes** may maintain artefacts, run sync reports, and push scoped file updates when assigned.

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
2. List all `suggestions/*.md` with Status Open / Countered.
3. Flag Decision trails that only contain the proposer (no peer or human response).
4. Flag any prompt/operating-model drift it notices (missing files, broken links).
5. Report paths + one-line status; do not invent Accept/Reject on behalf of others.

---

## Anti-patterns

- Accepting or rejecting only in a chat window
- Editing collaboration docs without pull first
- Long parallel debates with no suggestion file
- Treating fixture UI or local branches as team state
- Hermes acting as a fifth architecture peer instead of Executor/Memory

---

## Summary

Pull → read collaboration folder → write durable artefacts → Decision trail → human Status → PR for code.  
GitHub is the bus. Everything else is a client.
