# EXPADIO Continuous Multi-AI Operating Model

**Status:** Active  
**Participants:** Grok · ChatGPT · Gemini · Claude · Hermes Agent · Human Owner  
**Authority:** The human owner is the sole final decision maker.

---

## Core Model

```text
Any of the four reasoning AIs can be the Primary Worker on a task
        │
        ▼
The other reasoning AIs act as Reviewers / Suggestors
(in parallel or after the primary produces something)
        │
        ▼
Hermes Agent acts as Executor / Persistent Memory / Automation
(runs scoped tasks, maintains artefacts, accumulates project knowledge)
        │
        ▼
Human Owner remains the final decision maker
Accept / Counter / Reject / Request changes
```

This is a **peer-review + rotating-primary + dedicated executor** model. No AI is permanently in charge of judgment. Hermes provides continuity and execution muscle. Authority stays with the human.

---

## Roles

| Role | Who | Responsibility |
|------|-----|----------------|
| **Primary Worker** | Any one of Grok / ChatGPT / Gemini / Claude (per task) | Produces the main reasoning output: evaluation, design, implementation plan, suggestion, etc. |
| **Reviewer / Suggestor** | The other three reasoning AIs | Evaluate using the Shared Evaluation Template, raise red flags, applaud good work, or open/update suggestion files |
| **Executor / Memory / Automation** | Hermes Agent | Executes well-scoped operational tasks, maintains collaboration files, persists project knowledge, runs checks/tests when asked. Does **not** act as a fifth equal peer reviewer. |
| **Final Decision Maker** | Human Owner only | Accepts, Counters, Rejects, or requests changes. Binding authority. |

Any reasoning AI may also proactively open a suggestion even when not Primary. Hermes may surface observations found during execution but does not hold architectural authority.

---

## Operating Rhythm

1. **Task is defined** (by human or proposed by a reasoning AI).
2. **Primary is named** among the four reasoning AIs (explicitly by the human, or volunteered and confirmed).
3. **Primary produces work** and, where useful, records it (evaluation or suggestion file).
4. **Other reasoning AIs respond** using the Shared Evaluation Template or suggestion Decision trail.
5. **Hermes may be assigned** concrete follow-up execution (update files, run tests, summarise open suggestions, etc.) and reports results with evidence.
6. **Human closes the loop** — Accept, Counter, Reject, or request another round.
7. Process repeats.

---

## Rules of Engagement

- **Name a Primary** (from the four reasoning AIs) for any non-trivial piece of work.
- **Reviewers act freely** — they do not need permission to evaluate or open a suggestion.
- **Hermes stays in the Executor/Memory lane** — scoped execution, artefact maintenance, persistent knowledge. Escalate judgment questions.
- **Disagreement among reasoning AIs is expected and useful.** Record it in the Decision trail.
- **Architecture documents remain the source of truth.**
- **No AI has authority over another.** Only the human issues binding decisions.
- **Keep hand-offs structured.** Prefer the evaluation template and suggestion files.
- **Celebrate good work.** Explicit applause reinforces strong patterns.

---

## When no Primary is named

Any reasoning AI may still raise a red flag, open a suggestion, or perform an evaluation. Hermes may still maintain artefacts or run previously approved automations. For implementation or multi-step judgment work, a Primary among the four reasoning AIs should be named.

---

## Artefacts

| Artefact | Location | Purpose |
|----------|----------|---------|
| Shared Evaluation Template | `docs/collaboration/README.md` | Standard format for reviews |
| Suggestions + Decision trail | `docs/collaboration/suggestions/` | Durable proposals and Accept/Counter/Reject history |
| This operating model | `docs/collaboration/OPERATING-MODEL.md` | The rules of continuous collaboration |
| Reasoning AI prompts | `GROK_`, `CHATGPT_`, `GEMINI_`, `CLAUDE_COLLABORATION_PROMPT.md` | Standing orders for peer reviewers |
| Hermes prompt | `HERMES_COLLABORATION_PROMPT.md` | Standing orders for Executor/Memory role |

---

## Summary

- Four reasoning AIs collaborate as peers (Primary + Reviewers).
- Hermes provides execution, memory, and automation continuity.
- The human remains the final decision maker.
- Everything important is written down in the collaboration folder.

This model is now active.
