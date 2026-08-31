# EXPADIO Continuous Multi-AI Operating Model

**Status:** Active  
**Suggest / audit (Primary):** Grok · Claude  
**Execute:** Gemini · ChatGPT  
**Review:** Any active peer who did **not** author the substantive revision under review  
**Paused:** Hermes Agent  
**Authority:** Human owner retains override and sole authority to amend freeze/checklist/release gates. Day-to-day suggestion Accept / Counter / Reject closes among active peers **in the repo** under the rules below.

---

## Core Model

```text
Primary (Grok or Claude) proposes → suggestion file + PR as needed
        │
        ▼
Independent reviewer (did not author substantive changes) →
  Accept | Counter (blocking or non-blocking) | Reject
        │
        ▼
All blocking Counters resolved (Primary accept+revise, or explicit adjudication)
        │
        ▼
Independent Accept of the *current* revision → Status: Accepted
        │
        ▼
One executor claims the pack (name, branch, PR, handoff) → implements
        │
        ▼
Merge/deploy only via normal repo protections + required CI — never implied by Accepted alone
```

**Accepted authorizes scoped implementation work only.** It does **not** mean automatic merge, deployment, or CI bypass.

---

## Roles

| Lane | Who | Rules |
|------|-----|--------|
| **Suggest / audit** | Grok · Claude | Open suggestions; revise on accepted counters; may draft packs |
| **Review** | ChatGPT · Gemini · the other Primary | Must be **independent**: reviewer must not be the author of the substantive changes being accepted. Co-authors do not Accept their own revision. |
| **Execute** | Gemini · ChatGPT | After Accepted + **executor claim** recorded; one owner per pack |
| **Paused** | Hermes | No assignments |
| **Override / gates** | Human | Freeze, checklist gates, vertical unpause, waive required CI, production side effects, roster/Hermes, break ties on unresolved blocking counters |

---

## Autonomous Decision trail protocol

### 1. Propose

- Primary writes `docs/collaboration/suggestions/YYYY-MM-DD-title.md`.
- Status: **Open**. Decision trail: “Proposed by …”.

### 2. Independent review

- Reviewer must **not** have authored the substantive proposal text (or the latest substantive revision) they are Accepting.
- Append **Accept** | **Counter** | **Reject** with evidence.
- Mark each Counter as **blocking** or **non-blocking**.
- **Accept is always tied to a specific revision** (commit SHA or “body as of DATE/trail entry”). Accept of an old revision does not close a newer revision.

### 3. Blocking counters cannot be bypassed

- Status must **not** move to Accepted while any **blocking** Counter remains without:
  - Primary **Accept counter** + revised body + new independent Accept of that revision, or
  - Primary **Reject counter** with rationale **and** human or a second independent peer **explicit adjudication** on the trail, or
  - Human override on the trail.
- A single peer Accept does **not** close the item if another peer’s blocking Counter is still open.

### 4. Primary response to Counter

- **Accept counter** → revise body; trail “Counter accepted; proposal revised @ <ref>.”
- **Reject counter** → trail rationale; leave Status Open until adjudication.
- Do not leave blocking Counters unanswered across sessions.

### 5. Close

- **Accepted** only when: independent Accept of **current** revision + no unresolved blocking Counters.
- **Rejected** on freeze/architecture violation per independent review (or human).
- **Implemented** when merged work is linked (PR number).

### 6. Executor ownership (before implementation starts)

On the suggestion Decision trail (or pack section), record **before** coding:

```text
Executor claim:
  owner: Gemini | ChatGPT
  pack: <name or number>
  branch: <branch>
  pr: <url or TBD>
  status: claimed | in_progress | handoff | done | abandoned
```

- Only **one** active owner per pack. Second executor must not start the same pack without trail **handoff** (previous owner → abandoned or handoff + new claim).
- Claim does not bypass review rules or repo protections.

### 7. Accepted ≠ merge/deploy

- Accepted → permission to open implementation PRs within SCOPE.
- Merge requires normal branch protection, reviews if configured, and **required CI green**.
- Agents must not waive required checks. Human-only to waive.

### 8. Human-only

Freeze/checklist gate edits, vertical unpause, CI waiver, unauthorized production side effects, re-enable Hermes, roster change, final adjudication of stuck blocking counters when peers disagree.

---

## Operating Rhythm

1. Pull `main` / load prompt / read this file + `SYNC.md`.
2. Scan Open suggestions, blocking Counters, Accepted items without executor claim, claimed packs in progress.
3. Propose / independent review / resolve counters / claim / execute.
4. All durable state on the Decision trail and PRs.

---

## Rules of Engagement

- Repo is the bus.
- Independent review only for Accept.
- Blocking Counters block Accepted.
- One executor claim per pack.
- Accepted ≠ auto-merge or CI bypass.
- Hermes paused.
- Architecture and freeze docs are source of truth.

---

## Artefacts

| Artefact | Location |
|----------|----------|
| This model | `OPERATING-MODEL.md` |
| Sync | `SYNC.md` |
| Framework index | `README.md` |
| Suggestions | `suggestions/` |
| Prompts | `GROK_`, `CLAUDE_`, `CHATGPT_`, `GEMINI_COLLABORATION_PROMPT.md` |
| Paused | `HERMES_COLLABORATION_PROMPT.md` |

---

## Summary

Grok/Claude suggest · independent peers review · blocking counters resolved · Gemini/ChatGPT claim and execute · Hermes paused · human gates and override · Accepted authorizes scoped PRs only, not merge/deploy/CI bypass.

This model is now active.
