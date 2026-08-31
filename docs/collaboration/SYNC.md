# EXPADIO Collaboration Sync Rules

**Status:** Active  
**Active agents:** Grok · ChatGPT  
**Paused:** Gemini · Claude · Hermes  
**Purpose:** Keep Grok, ChatGPT, and the human aligned without relying on chat history or human message-passing between agents.

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

- Grok proposes (default) → ChatGPT Accept / Counter / Reject on the **Decision trail** (roles may swap if recorded).
- Primary accepts or rejects **Counter** on the same trail and revises the body when accepting.
- Either peer may set **Status: Accepted** or **Rejected** when the trail supports it — **without waiting for a human prompt each turn**.
- **Hermes is paused** — do not assign sync-report automation or pack execution to Hermes until re-enabled in `OPERATING-MODEL.md`.
- Human-only exceptions: freeze/checklist gate amendments, vertical unpause, waiving required CI, unauthorized production side effects, changing the active agent roster.

Agents must not ask the human to “tell the other agent” what was decided. Write the trail; the other agent pulls it next session.

---

## Mandatory session start (Grok and ChatGPT only)

1. `git fetch origin` and update to current `main` (or the agreed working branch).
2. Load your role prompt (`GROK_COLLABORATION_PROMPT.md` or `CHATGPT_COLLABORATION_PROMPT.md`).
3. Read `OPERATING-MODEL.md` and this file (`SYNC.md`) — note **active vs paused** roster.
4. Scan `suggestions/` for:
   - `Status: Open` items
   - Decision trails awaiting **your** reply (Counter without Primary response, Open without peer review)
   - `Status: Accepted` with implementation still pending
5. Only then start new work.

Paused agents have no session-start obligation until re-enabled.

---

## How work stays in sync

1. **Propose** → new file in `suggestions/` (naming + structure per `suggestions/README.md`).
2. **Respond** → Append to that file’s **Decision trail** (Accept / Counter / Reject + short rationale). Do not counter only in chat.
3. **Resolve Counter** → Primary revises body and trails “Counter accepted; proposal revised,” or rejects counter with rationale.
4. **Peer closes** → `Status` Accepted / Rejected when protocol allows. Human may always override.
5. **Implement** → Grok and/or ChatGPT via PR; when merged, set suggestion to `Implemented` and link the PR.
6. **Do not route execution through Hermes** while paused.

---

## Auto checks (CI)

Workflow: `.github/workflows/collaboration-sync.yml`

On changes under `docs/collaboration/**` it validates that suggestion files (except `README.md`) include required sections and a valid Status line.

Fix CI failures before treating collaboration docs as settled.

---

## Agent GitHub access

See `CONNECTING-AGENTS.md` for how each participant connects. Only **Grok** and **ChatGPT** need write access for the current roster. Hermes/Gemini/Claude access may remain provisioned but unused until re-enabled.

---

## Sync report (Grok or ChatGPT, on demand)

When producing a sync report:

1. Pull latest `main`.
2. List all `suggestions/*.md` with Status Open / Accepted (pending implementation).
3. Flag Decision trails that only contain the proposer (no peer response).
4. Flag Counters with no Primary response.
5. Report paths + one-line status.

---

## Anti-patterns

- Accepting or rejecting only in a chat window
- Asking the human to relay a decision to the other agent instead of writing the Decision trail
- Assigning packs or sync jobs to **Hermes** while paused
- Expecting Gemini/Claude review while they are paused
- Editing collaboration docs without pull first
- Leaving Counter unanswered
- Autonomous Accept of freeze/checklist gate changes or vertical unpause

---

## Summary

Pull → read collaboration folder → Grok/ChatGPT Decision trail → resolve counters → Status in-repo → packs by Grok/ChatGPT.  
GitHub is the bus. **Active roster: Grok + ChatGPT only.** Human is override and gate authority, not the message router.
