# ADR-013 — Learning automation uses the shared governed action spine

**Status:** Accepted for LMS-07  
**Scope:** Shared Learning module automation

## Decision

Learning automation is configuration and aggregate enrichment over EXPADIO's
existing Domain Event and Governed Action infrastructure.

Learning does **not** own a second automation engine.

The execution path is:

```text
Learning mutation
  → existing platform.domain_events
  → existing platform.domain_event_outbox
  → existing leased Domain Event action worker
  → tenant learning_automation_rules
  → existing governed Action resolution
  → existing platform.governed_action_intents
  → existing executor
       CREATE_TASK
       COMMUNICATE
       SCHEDULE
  → existing execution evidence / retry / provider infrastructure
```

## Ownership

### Learning owns

- Learning event vocabulary already emitted by Learning domain runtimes.
- Tenant-scoped Learning automation rule configuration.
- Runtime enrichment of a Learning event with current learner aggregate fields
  needed to resolve safe bindings.
- Learning-specific rule administration APIs.

### EXPADIO platform owns

- Domain Event persistence.
- Transactional outbox.
- Outbox leasing and retry.
- Governed Action resolution.
- Immutable Action Intent persistence.
- Executor classes.
- Execution-attempt evidence.
- Operational tasks.
- Scheduled governed actions.
- Communications routing/compliance/provider delivery.
- Business execution trace.

## Rule model

A tenant Learning automation rule declares:

- stable rule key
- one `learning.*` event type
- one already-supported executor class
- action key
- enabled state
- optional policy keys
- configuration/binding template
- optimistic revision

Initial executor classes are intentionally limited to:

- `CREATE_TASK`
- `COMMUNICATE`
- `SCHEDULE`

Adding a new Learning executor class is prohibited unless that executor first
exists as a horizontal EXPADIO executor.

## PII boundary

Rule configuration stores bindings, not learner data.

At event-processing time the Learning adapter may resolve current learner
context such as subject ID, name, or email. Materialized Action Intents may then
contain the concrete values required by the horizontal executor, consistent
with the existing governed-action model.

## Entitlement behavior

If Learning is unavailable, locked by plan, suspended, or otherwise not
operational, tenant Learning rules resolve to an empty set.

This is deliberate:

- no side effect may execute after commercial/module suspension;
- an already-persisted Learning outbox item is still consumed;
- the outbox must not retry forever merely because the module was later
  suspended;
- all Learning data and historical execution evidence remain preserved.

## Failure behavior

A configured rule fails closed when:

- a required binding cannot be materialized;
- the rule declares policy keys but no evaluator is supplied;
- governed policy denies the action;
- an existing executor refuses malformed configuration.

The shared worker retains its existing retry/dead-letter semantics for genuine
materialization or execution failure.

## Deliberate non-goals

LMS-07 does not add:

- a Learning-specific scheduler;
- a Learning-specific worker;
- a Learning-specific outbox;
- a general expression language;
- cron rules;
- arbitrary code actions;
- new executor classes;
- provider credentials;
- UI workflow builder;
- AI automation.

Those concerns remain horizontal platform capabilities or later bounded slices.
