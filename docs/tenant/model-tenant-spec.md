# Brand-neutral model tenant

Northstar Services demonstrates the shared tenant product before any DENTEX
extension. `/tenant?mode=model` is an explicit read-only fixture, uses no tenant
API, sends nothing, and persists no business changes. It is not a complete or
production-seeded tenant.

## Implemented model

- One customer: Jordan Lee, with a deliberately non-deliverable example address.
- One pending onboarding case and one open review task, consistently linked.
- No fabricated approval or communication outcome.
- Shared Overview, Activity, Tasks, Communications, Documents and Decisions
  sections. Unconnected sections say so.
- Model and live mode never fall back to each other.

## Target complete model (not built yet)

| Role | Primary home emphasis | Authority boundary |
|---|---|---|
| Owner | Needs me, business work, verified system outcomes | Permitted business configuration; no provider custody |
| Location manager | Work in permitted locations | No cross-location visibility or action |
| Operator | Assigned tasks and legal next steps | Cannot approve own work |
| Approver | Required reviews | Must have action authority and required evidence |

Create a customer/case event, propose follow-up work, require review, persist a
permitted schedule, dispatch through EXPADIO and reconcile observed outcomes.
Exercise denial, duplicate submissions, errors and uncertain outcomes with the
same backend used for live tenants. A schedule is not approval or delivery.

Locations, multiple roles, persisted review/schedule commands and communication
outcomes are still release gates. The current fixture does not simulate them as
working product. DENTEX later adds real care-plan/discharge objects and policy to
this kernel, without a second customer inbox or forked work backend.
