# EXPADIO Collaboration Sync Rules

**Status:** Active  
**Suggest / audit:** Grok · Claude  
**Execute:** Gemini · ChatGPT  
**Paused:** Hermes  
**Purpose:** Shared memory and session rules for autonomous peer decisions.

---

## Single source of truth

```text
Chat sessions are ephemeral.
GitHub (this repository) is the only shared memory.
```

**Rule:** If a decision is not in the repo, it did not happen for the team.

---

## Decision close rules (short)

Full text: `OPERATING-MODEL.md`.

- **Independent review:** Accept only if you did not author the substantive revision under review.
- **Blocking Counters:** Status cannot become Accepted until each blocking Counter is resolved or explicitly adjudicated on the trail.
- **Executor claim:** Before implementation, one of Gemini/ChatGPT records owner, pack, branch, PR, status on the trail. No double-pickup without handoff.
- **Accepted** = scoped implementation authorized. **Not** automatic merge, deploy, or CI bypass. Repo protections still apply.

---

## Mandatory session start

1. Fetch/pull `main`.
2. Load your prompt (`GROK_` / `CLAUDE_` / `CHATGPT_` / `GEMINI_COLLABORATION_PROMPT.md`).
3. Read `OPERATING-MODEL.md` + this file.
4. Scan `suggestions/` for:
   - Open items needing independent review
   - Blocking Counters without Primary response
   - Accepted items missing executor claim
   - Your claimed packs (if executor)
5. Work only in-lane (suggest vs execute defaults).

Hermes: no session obligation while paused.

---

## How work stays in sync

1. Propose (Grok/Claude) → suggestion file  
2. Independent review → Accept / Counter / Reject  
3. Resolve blocking Counters  
4. Status Accepted  
5. Executor claim → implement → PR → required CI → merge per repo rules  
6. Set Implemented + link PR  

---

## Anti-patterns

- Chat-only decisions  
- Self-Accept of your own substantive revision  
- Accepted while a blocking Counter is open  
- Two executors on one pack without handoff  
- Treating Accepted as merge/deploy permission  
- Assigning Hermes while paused  
- Asking the human to relay decisions between agents  

---

## Summary

Pull → independent review → resolve blocking counters → claim → PR under normal protections. Human = gates and override, not the router.
