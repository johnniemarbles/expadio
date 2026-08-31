# Neutral Model Tenant Specification

## Purpose

Prove the tenant operating experience without binding the product to DENTEX or another industry. This model tenant is an executable fixture for the tenant shell, scope, role, work, customer, case, approval and communication lifecycle.

## Model tenant

**Tenant:** Northstar Services  
**Brand:** Northstar  
**Locations:** Northstar HQ, East District, West District  
**Fixture label:** Demo data — not production truth

## Roles

| Role | Default home | Can do | Cannot do |
|---|---|---|---|
| Tenant owner | Business overview | Configure tenant, locations, workflows and team | Bypass platform safety or provider custody |
| Location manager | Location operations | Assign work, manage local customers and cases | Act outside assigned location scope |
| Operator | My work | Execute assigned tasks and submit work for review | Approve own submitted work |
| Approver | Approvals | Approve or request changes within authority | Approve outside scope or without required evidence |

## Neutral objects

- Customer
- Customer activity
- Case
- Task
- Follow-up
- Workflow
- Approval
- Communication
- Location
- Document
- Decision
- Audit event

## First executable journey

```text
Customer/case event
  → create follow-up
  → schedule communication
  → create review task
  → approve or request changes
  → execute communication
  → reconcile provider result
  → record outcome in customer activity and audit
```

The UI must show these distinct states:

**Draft → Awaiting review → Approved → Scheduled → Queued → Sent → Delivered**

Failures and uncertain outcomes must be explicit and recoverable:

**Failed / Retry available** and **Outcome uncertain / Reconcile**

## Tenant screens

- Home: needs attention, what is happening, what the system completed
- My work: My tasks, Approvals, Team queue, Overdue, Exceptions
- Customers: shared record with Overview, Activity, Tasks, Communications, Documents and Decisions
- Communications: schedules, templates, sender identities, delivery outcomes
- Business settings: team, locations, capabilities, domains, senders and workflows
- Activity & audit: technical terms, correlation IDs and policy evidence

## Scope rules

- Unauthorized brands and locations are absent, not disabled in selectors.
- Visibility scope and action scope are resolved independently.
- A location manager sees only permitted locations and can act only within action scope.
- All counts, lists, links and commands carry the active tenant/brand/location context.
- Server-side authorization, entitlement, SoD and idempotency are mandatory on every command.

## Fixture scenarios

1. Operator submits a follow-up; the Approve action is disabled with “You submitted this work. Another reviewer is required.” The legal next step is Request review.
2. Approver approves; the customer record shows Approved, then Scheduled and Queued as execution proceeds.
3. Provider returns Delivered; activity and audit show the outcome and correlation reference.
4. Replaying the same command does not create a second task, schedule or communication.
5. Provider timeout shows Outcome uncertain and exposes reconciliation/retry, not false success.
6. Location manager attempts a cross-location conversion and receives a clear denial with no state change.
7. Mobile user opens a customer record and completes the same permitted task without clipped tables or inaccessible drawers.

## Vertical extension contract

DENTEX must reuse this kernel and add only:

- Patient and practice labels
- Care-plan and treatment objects
- Clinical workflow stages
- Clinical roles and policies
- Discharge-specific follow-up rules
- Jurisdiction-specific communication constraints

DENTEX must not fork the customer, work, approval, communication, scope or audit infrastructure.
