# EXPADIO Tenant Feature Map

Status: build-gate draft, grounded in the locked tenant product thesis and the available platform audit history. Repository/API verification is required before implementation because the current workspace contains only the directional HTML prototype.

## Product contract

The brand runs the business through connected work. EXPADIO executes, governs, isolates and owns providers underneath. Tenant UI must expose only verified capabilities, enforce view scope separately from action scope, and use business language by default.

## Surface map

| Tenant surface | Existing backend foundation | Tenant-safe API required | Primary permission/scope | UI journey | Status |
|---|---|---|---|---|---|
| Home | Health/read models, CRM, work/decision data, communication outcomes | `GET /tenant/home` composed read model | Tenant membership; visibility scope; role-shaped cards | Needs me → happening → completed → open work | Partial |
| My work | Governed actions, tasks, approvals, recovery/health signals | Queue query + task/approval command endpoints | Assigned/team queue; maker/approver SoD | My tasks / approvals / team / overdue / exceptions | Partial |
| Customers | Party, lead, case, agreement CRM objects | Unified customer list/detail/activity APIs | Brand + permitted locations; action scope per command | Customer → Overview / Activity / Tasks / Communications / Documents / Decisions | Partial |
| Communications | Delivery, provider registry, credentials, webhooks, traces | Tenant delivery/read APIs; sender/template configuration APIs | Tenant entitlement; recipient/brand scope; platform-owned provider custody | Schedule → review → queued → sent → delivered/failed | Partial |
| Growth | Capture websites/forms, campaigns, AutoGTM/social proposals | Verified capability-specific APIs only | Feature entitlement + scope + approval policy | Capture sources and approved growth workflows | Platform-only / planned |
| Knowledge & AI | AI gateway, knowledge, agent runtime, trace/evidence surfaces | Tenant-safe evidence/proposal/review APIs | Read/write knowledge policy; proposals cannot execute | Evidence → proposal → review → approved context | Partial |
| Business settings | Business config, roles, locations, workflows, sender/domain model | Tenant configuration APIs | Tenant admin; no provider credential ownership | Team, locations, capabilities, domains, senders, templates, workflows | Partial |
| DENTEX care plans | DENTEX clinical model, extraction/care-plan work | Case/care-plan/discharge APIs | Clinical role + location + governed transitions | Care plan → discharge → scheduled follow-up → review task → communication outcome | Partial; first verified path |

## Explicitly hidden until proven ready

- AutoGTM execution and publication
- Social publishing
- Inbound conversation workspace
- Any provider credential or transport administration

These may appear as planned/setup states, never as enabled production controls, until the API, entitlement, authorization, execution and reconciliation path is verified.

## Permission model required in every surface

1. Resolve tenant, brand and location visibility from the authenticated membership.
2. Resolve action permissions independently from visibility.
3. Disable or omit unauthorized actions with a plain-language reason.
4. Show the legal next step: request review, assign owner, escalate, or contact an administrator.
5. Re-check authorization, entitlement, SoD, idempotency and scope on the server.
6. Persist command result, correlation/audit reference and execution status.

## First implementation slice

### Shell, scope and setup

- Tenant shell with responsive mobile navigation.
- Explicit brand/location scope selector that changes every query and count.
- Role-shaped Home and My work tabs.
- Unauthorized brands absent from all selectors and navigation.
- Focus-trapped, keyboard-accessible drawers and usable responsive tables.
- Setup checklist for team, location, sender identity, domain and enabled capabilities.

### Verified DENTEX path

```text
case/discharge
  → scheduled follow-up
  → review task / approval
  → communication intent
  → provider execution
  → delivery/reconciliation outcome
  → customer/case activity and audit
```

The UI must distinguish approved, scheduled, queued, sent, delivered and failed. Each transition needs validation, pending state, persisted result, retry/idempotency behavior and an audit reference.

## Acceptance gates

- Cross-tenant and cross-location read denial.
- View scope cannot grant action scope.
- Maker cannot approve own work; disabled control explains the reason and next step.
- Duplicate submit/replay creates no duplicate task, schedule or delivery.
- Provider failure and uncertain outcome are visible and recoverable.
- Fixture data is internally consistent; no contradictory counts or statuses.
- Mobile widths, keyboard navigation, focus return and screen-reader labels pass.
- Every enabled button maps to a real API command or is removed/marked planned.

## Build decision

Do not begin with a visual rewrite. First verify each row against the repository and attach exact route, controller/service, permission, and test references. Then implement the shell and the DENTEX path only where the map reads **ready** or has an explicitly bounded implementation slice.
