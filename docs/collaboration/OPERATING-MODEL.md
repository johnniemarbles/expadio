# EXPADIO Continuous Multi-AI Operating Model

**Status:** Active  
**Participants:** Grok · ChatGPT · Gemini · Claude · Human Owner  
**Authority:** The human owner is the sole final decision maker.

---

## Core Model

```text
Any AI can be the Primary Worker on a task
        │
        ▼
The other three act as Reviewers / Suggestors
(in parallel or after the primary produces something)
        │
        ▼
Human Owner remains the final decision maker
Accept / Counter / Reject / Request changes
```

This is a **peer-review + rotating-primary** model. No AI is permanently in charge. Work keeps moving, quality is continuously challenged, and authority stays with the human.

---

## Roles

| Role | Who | Responsibility |
|------|-----|----------------|
| **Primary Worker** | Any one of the four AIs (per task or session) | Produces the main output: code, evaluation, design, implementation plan, suggestion, etc. |
| **Reviewer / Suggestor** | The other three AIs | Evaluate using the Shared Evaluation Template, raise red flags, applaud good work, or open/update suggestion files |
| **Final Decision Maker** | Human Owner only | Accepts, Counters, Rejects, or requests changes. Binding authority. |

Any AI may also proactively open a suggestion even when not Primary.

---

## Operating Rhythm

1. **Task is defined** (by human or proposed by an AI).
2. **Primary is named** (explicitly by the human, or volunteered and confirmed).
   - Example: “Grok is Primary on this review. Others: evaluate when ready.”
3. **Primary produces work** and, where useful, records it (code, evaluation, or a suggestion file).
4. **Other AIs respond** using either:
   - the Shared Evaluation Template (`docs/collaboration/README.md`), or
   - a new/updated file in `docs/collaboration/suggestions/` with Accept / Counter / Reject + rationale in the Decision trail.
5. **Human closes the loop** — Accept, Counter, Reject, or request another round.
6. Process repeats.

---

## Rules of Engagement

- **Name a Primary** for any non-trivial piece of work. Without clear ownership, four parallel opinions can stall progress.
- **Reviewers act freely** — they do not need permission to evaluate or open a suggestion.
- **Disagreement is expected and useful.** Record it in the Decision trail; do not try to force consensus.
- **Architecture documents remain the source of truth.** Personal preference loses to `docs/architecture/`.
- **No AI has authority over another.** Only the human issues binding decisions.
- **Keep hand-offs structured.** Prefer the evaluation template and suggestion files over free-form debate.
- **Celebrate good work.** Explicit applause reinforces strong patterns.

---

## When no Primary is named

Any AI may still:
- Raise a red flag
- Open a suggestion
- Perform an evaluation

But for implementation or multi-step work, the human (or a volunteering AI confirmed by the human) should designate a Primary so the work has a clear owner.

---

## Artefacts

| Artefact | Location | Purpose |
|----------|----------|---------|
| Shared Evaluation Template | `docs/collaboration/README.md` | Standard format for reviews |
| Suggestions + Decision trail | `docs/collaboration/suggestions/` | Durable proposals and Accept/Counter/Reject history |
| This operating model | `docs/collaboration/OPERATING-MODEL.md` | The rules of continuous collaboration |
| Individual prompts | `GROK_`, `CHATGPT_`, `GEMINI_`, `CLAUDE_COLLABORATION_PROMPT.md` | Standing orders for each AI |

---

## Summary

- Any AI can work.
- The others can always check, evaluate, or suggest.
- The human remains the final decision maker.
- Everything important is written down in the collaboration folder so all four AIs stay aligned.

This model is now active.
