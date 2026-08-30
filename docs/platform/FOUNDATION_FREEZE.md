# EXPADIO Platform Foundation Freeze

Status: active freeze contract  
Audit head: `f712495c1f391ed4947b86638174f8bb2b5bc51c`  
Effective date: 2026-08-30

## Decision

The horizontal execution foundation is now considered production-shaped and should be treated as frozen except for targeted hardening, observability, recovery, security, and compatibility work.

The product strategy is now:

```text
Pause vertical expansion
Pause DENTEX product-depth work
Protect horizontal primitives
Complete platform runtime capability
Resume vertical/product multiplication later
```

## Frozen horizontal primitives

The following platform primitives are frozen as canonical architecture:

- tenancy and PostgreSQL RLS as the tenant isolation boundary
- request context and tenant-scoped transaction application
- Decision Fabric for governed workflow decisions
- Domain Event Fabric
- transactional outbox
- lease-safe event workers
- tenant scheduler and tenant execution leases
- Governed Action Fabric
- `COMMUNICATE` executor
- `SCHEDULE` executor
- `CREATE_TASK` executor
- durable communication deliveries
- provider delivery claims and leases
- late compliance checks before external side effects
- credential custody / credential lease pattern
- provider attempt evidence and acceptance reconciliation
- verified provider webhook ingestion
- append-only webhook evidence
- business execution trace read model
- execution trace API
- read-only execution trace operator surface

## Non-negotiable architecture rules

Future platform, vertical, AI, agent, voice, integration, and embedded work must follow these rules.

### No duplicate core engines

Do not add a second implementation of:

- queue / outbox
- task engine
- communication delivery engine
- scheduler
- workflow engine
- authorization model
- audit/provenance model
- provider credential custody
- execution trace

If a new need appears, extend the frozen horizontal primitive or add a narrowly scoped adapter around it.

### No vertical forks of horizontal capabilities

Vertical packages may define domain models, domain events, rules, templates, and pack-specific mappings.

Vertical packages must not fork:

- identity
- tenancy
- authorization
- communication delivery
- workflow / Decision Fabric
- event / outbox infrastructure
- Action Fabric
- AI gateway
- provider abstraction
- audit / trace infrastructure

### No direct AI or agent mutation

AI systems and agents must not directly mutate business tables.

Allowed outputs:

- recommendation
- classification
- summary
- draft
- proposal
- structured candidate action

Business mutation must flow through:

```text
AI / agent output
  -> policy and provenance
  -> human approval when required
  -> Governed Action
  -> existing executor
  -> trace
```

### No implicit demo fallbacks in production code

Production routes and executors must not silently fall back to:

- demo tenant
- demo organization
- default connector
- synthetic user
- mock provider
- fake delivery result

Demo fixtures and seed data are allowed only in explicitly named demo/test files and must not be used as runtime fallback behavior.

### Provider side effects must be evidenced

External side effects must be represented through durable evidence:

```text
attempt evidence
provider response evidence
webhook evidence where applicable
canonical lifecycle update
trace visibility
```

Provider acceptance must not be treated as successful final business outcome unless the relevant canonical lifecycle has been reconciled.

### Recovery must be governed

Operational recovery must not repair records directly from UI.

Recovery actions must be expressed as governed commands such as:

- retry
- cancel
- mark resolved
- create task
- escalate

and must leave audit and execution trace evidence.

## Allowed foundation changes

The freeze does not block production hardening.

Allowed work includes:

- provider lifecycle transition hardening
- duplicate/replayed/out-of-order webhook behavior
- health read models
- operational alerting
- recovery command center
- capability-level authorization normalization
- CI and integration test expansion
- security/compliance controls
- additional Action Fabric executors
- AI, knowledge, agent, and voice foundations that reuse the frozen primitives

## Paused work

The following are intentionally paused until platform capability is broader:

- DENTEX clinical product depth
- second vertical implementation
- WeRealtors
- Nordrux / TPA / LIMS vertical depth
- insurance vertical depth
- LMS
- community
- jobs
- marketplace
- mobile app feature depth

## Immediate platform-only program

The current execution order is:

1. foundation freeze and checklist
2. provider lifecycle transition hardening
3. webhook duplicate/replay/out-of-order tests
4. execution health read models
5. platform health API
6. platform health dashboard
7. governed recovery model
8. recovery queue API
9. recovery command center
10. Action Fabric breadth: `ASSIGN`, `REQUEST_APPROVAL`, `WEBHOOK`, `START_WORKFLOW`, `ADVANCE_WORKFLOW`, `CREATE_DOCUMENT`
11. capability-level authorization vocabulary
12. CI expansion
13. Knowledge Engine foundation
14. AI Gateway foundation
15. Agent Runtime foundation
16. Voice Gateway foundation
17. API / SDK / embedded platform productization
18. Platform Admin completion
19. billing / usage / entitlement
20. security and compliance completion

## Freeze review policy

This document should be updated only when the platform architecture intentionally changes.

Checklist progress belongs in:

```text
docs/platform/PLATFORM_COMPLETION_CHECKLIST.md
```
