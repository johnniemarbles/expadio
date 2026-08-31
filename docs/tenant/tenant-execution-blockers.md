# Tenant execution release gates

The tenant read slice is implemented; tenant actions are not. No model action
mutates local state and claims persistence. No tenant UI calls simulated
governance approval endpoints.

Before enabling a brand-neutral follow-up journey:

1. Verify case/customer organization and location ownership in canonical records.
2. Map the canonical review/decision command and entitlement, including separate
   read and action authority; reject self-approval server-side.
3. Use existing operational tasks and scheduled governed actions, not parallel
   tenant task or schedule tables.
4. Return durable command state, idempotency result and audit reference.
5. Confirm scheduling does not imply approval and dispatch remains policy-gated.
6. Surface execution observations distinctly: queued, sent, delivered, failed,
   uncertain. Never infer delivery from a completed task or approved decision.
7. Prove duplicates, deny paths, failure and reconciliation through authenticated
   browser e2e and real deployment/database-role checks.

Read readiness and action readiness are separate. Existing governance routes
that return simulated outcomes must not be reused as production commands without
independent verification and replacement of their simulated write path.
