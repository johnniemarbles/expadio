# Audit live honesty — agent task packs

**Proposed by:** Grok  
**Date:** 2026-08-31  
**Status:** Accepted  
**Related area:** `apps/platform-web` (Audit page, activity API), live vs fixture scope, governed events integrity

## Problem / Opportunity

Live Org + Live Database Audit UI can show empty state while copy still refers to “fixture scope.” Activity path has used hard-coded demo tenant/org UUIDs and (when empty) risk of synthetic/fallback events. That breaks audit honesty: governed timeline must reflect real rows only, with copy that matches Live vs Fixture.

Observed surface (2026-08-26 UI): Audit page banner “Live Database (live)” + empty activity + fixture-oriented empty copy.

## Proposal

Ship **four bounded agent packs** (one concern per PR). Other AI agents (or Hermes as Executor) implement Packs 1–3 after Pack 0 status check. No application code in this suggestion commit — packs only.

**Order:** Pack 0 → Pack 1 → Pack 2 → Pack 3.

### Agent rules (all packs)

1. One pack → one branch → one PR.
2. PR description = paste the pack + list of files changed.
3. No drive-by refactors.
4. If acceptance cannot be met without leaving scope → stop and comment; do not expand.
5. Prefer smallest diff that satisfies ACCEPT.

---

## Pack 0 — Precondition (read-only, no code)

```text
TASK: Confirm CI Core Spine status before stacking PRs
GOAL: Do not merge Packs 1–3 on a red Core Spine if the workflow is required for the monorepo.

SCOPE: .github/workflows/ (read only) + Actions run history for Core Spine / run #110 class failures

DO:
1. Note whether Core Spine is failing (runner steps null / infra).
2. Report: green / red + one-line cause if visible.
3. Recommendation: fix runner or document “merge with CI exception” — not part of Packs 1–3.

DON'T: Change workflow YAML unless a separate pack is authorized.

ACCEPT: One short status note for the human/agent queue.
```

---

## Pack 1 — Live activity context (no hard-coded tenant/org)

```text
TASK: Resolve real tenant/org for live activity API
GOAL: Activity endpoint never uses hard-coded demo UUIDs when scope is live.

SCOPE (only these):
- apps/platform-web/app/api/activity/route.ts
- Any existing request-context / session helper already used by other live API routes in apps/platform-web (reuse, do not invent a new auth system)
- Tests that cover activity route (add/adjust only if present or minimal new test next to existing API tests)

DO:
1. Find how other live routes obtain tenantId + organizationId (same app).
2. Use that same path in activity/route.ts for live requests.
3. Delete hard-coded values:
   - tenantId: '00000000-0000-0000-0000-000000000001'
   - organizationId: '00000000-0000-0000-0000-000000000002'
4. If context is missing → 401/403 (or existing app error shape), not silent fallback to demo UUIDs.
5. Fixture/demo mode may keep explicit fixture IDs only when mode is clearly fixture — never when UI banner says Live.

DON'T:
- Change RLS migrations
- Change Clerk / auth provider wiring
- Add new packages
- Fabricate activity rows
- Touch workflow, audit package internals, or industry packs

ACCEPT:
- Live request with valid session → queries use that tenant/org
- Live request without session → fails closed
- No 00000000-0000-0000-0000-000000000001 / …0002 in live path
- pnpm check (or project equivalent) green for touched packages

STOP: If no shared request-context helper exists, stop and report the gap; do not invent a parallel auth path.
```

---

## Pack 2 — No synthetic audit events

```text
TASK: Remove fabricated activity when DB returns empty
GOAL: Empty result set means empty timeline. Never invent agent_run / sensitive_read / “system” events to fill the UI.

SCOPE (only these):
- apps/platform-web/app/api/activity/route.ts
- Any helper that builds “synthetic” or “fallback” activity arrays for this route
- Matching tests only

DO:
1. Locate logic that appends synthetic / demo / placeholder events when query is empty.
2. Remove it for live mode entirely.
3. Return [] (or existing empty payload shape) when there are no rows.
4. Keep real mapping only for rows that exist in governed tables (agent_run_events, sensitive_read_events, etc. — whatever the route already reads).

DON'T:
- Seed the database in this PR
- Change event schema or migrations
- “Helpful” sample data for live
- Change Audit page layout beyond what empty array already drives

ACCEPT:
- Live + empty tables → response events: []
- Live + real rows → those rows only
- No fake actor names, no invented timestamps, no placeholder “system” events in live
- pnpm check green for touched surface

STOP: If the only way the UI works is synthetic data, stop and report; do not restore fakes.
```

---

## Pack 3 — Empty-state copy matches Live vs Fixture

```text
TASK: Honest empty-state copy on Audit page
GOAL: When banner is Live Database (live), never claim “fixture scope.”

SCOPE (only these):
- apps/platform-web/app/(shell)/audit/page.tsx (or exact audit page path)
- Any small shared empty-state component used only by this page, if copy lives there

DO:
1. Detect live vs fixture the same way the page already does for the banner.
2. Empty + live → e.g. “No governed events in this scope.” (or existing product tone, but accurate)
3. Empty + fixture → may mention fixture scope.
4. Do not imply missing data is a product failure; just state absence of governed events.

DON'T:
- Redesign the Audit page
- Add charts, filters, or new data sources
- Change API response shape
- Touch other shell pages

ACCEPT:
- Live banner + empty API → live empty copy (no “fixture scope”)
- Fixture mode + empty → fixture wording OK
- No layout regressions beyond copy
- Manual or existing UI check sufficient; no new e2e required unless already present

STOP: If live/fixture flag is unavailable on the page, stop and report; do not hard-code “live” copy.
```

---

## Expected benefits

- Live Audit timeline is trustworthy (no demo tenant bleed, no fabricated events).
- Empty state copy matches Live vs Fixture banner.
- Other agents get executable fences (scope / don’t / accept / stop) aligned with collocation discipline.
- Small PRs; easy review against architecture and FOUNDATION freeze.

## Risks / trade-offs

- Empty live timeline may look “broken” until real governed events exist — that is correct behaviour, not a bug.
- Pack 1 depends on an existing request-context path; if missing, work stops and escalates (by design).
- Core Spine CI red may block safe merge of Packs 1–3 until Pack 0 is acknowledged.

## Implementation notes

- **This commit:** suggestion + packs only under `docs/collaboration/suggestions/`.
- **Code PRs:** separate branches per pack; implementers paste the pack body into the PR description.
- **Executor:** Hermes (or any connected agent) may run Pack 0 immediately; Packs 1–3 after human Accept on this suggestion (or explicit “implement pack N”).
- Do not combine Packs 1–3 into one PR.

## Decision trail

- **2026-08-31** — Proposed by Grok (audit red flags → agent-ready packs; human requested save to repo for other AI agents).
- **2026-08-31** — **Accepted by the human owner (Sanjeev Sood)**; recorded by ChatGPT on explicit instruction to review/merge PR #476 and mark this suggestion Accepted. [PR #476](https://github.com/johnniemarbles/expadio/pull/476) merged as `bb066e5be733a4f8488d653980e5c3abec850bf7` after both collaboration validation and architecture baseline checks passed. Accepts the bounded Pack 0 → Pack 1 → Pack 2 → Pack 3 plan; implementation remains pending, with separate code PRs and the stated CI/context preconditions unchanged. This acceptance does not authorize bypassing required checks.

- **2026-08-31 — ChatGPT executor claim, on the human instruction “execute the plan”.** Baseline `89d3056002e1b857b5a436d10fa1c388b3918179`; no overlapping audit-honesty PR was open at inspection. Terminal Git authentication is unavailable; pinned source reads and branch writes use the authenticated GitHub connector.
  - Pack 0: **red / runner-start failure**. [Core Spine run 33354673570](https://github.com/johnniemarbles/expadio/actions/runs/33354673570) has failed check/postgres-contract jobs, empty steps, runner_id 0. Exact account/infrastructure cause unverified. No CI waiver; do not merge implementation PRs until applicable checks are green.
  - owner: ChatGPT; pack: 1; branch: `fix/audit-live-context-pack1`; pr: TBD; status: in_progress.
  - owner: ChatGPT; pack: 2; branch: `fix/audit-real-events-pack2`; pr: TBD; status: claimed.
  - owner: ChatGPT; pack: 3; branch: `fix/audit-scope-copy-pack3`; pr: TBD; status: claimed.
  - Investigation found that migrations 0026/0035 store agent/sensitive-read events with tenant but no organization identifier. Pack 1 must establish existing organization/resource provenance before claiming isolation; a tenant-only filter or invented organization column is not an acceptable substitute. Schema changes remain outside Pack 1. Other bounded pack changes may be prepared for review but remain gated by Pack 1 and CI.

- **2026-08-31 — ChatGPT execution checkpoint (not implementation acceptance).**
  - Pack 0: **green on retry**. Once the new PRs demonstrated working runner allocation, retried only the failed jobs of [Core Spine run 33354673570](https://github.com/johnniemarbles/expadio/actions/runs/33354673570). Both `check` and `postgres-contract` passed on attempt 2 at PR #475 head `8ce8c87855f520b0b8eca6e69576ca47d4390157`. This resolves the inspected infrastructure precondition; it is not a claim that Core Spine ran against current main or the audit PR heads. No workflow changes, repeated rerun loop, or waiver.
  - Pack 1: owner ChatGPT; branch reserved `fix/audit-live-context-pack1`; pr none; status **handoff / blocked before code changes**. Existing request helper found, but correct organization/resource-scoped reads cannot be established within the pack's no-schema/no-auth-wiring scope. The scope-stop rule applies. Do not substitute tenant-only filtering, actor membership inference, or guessed organization IDs.
  - Pack 2: owner ChatGPT; branch `fix/audit-real-events-pack2`; [draft PR #479](https://github.com/johnniemarbles/expadio/pull/479), head `ff3558193f2d41972d5de7b58ffe6660f541051e`; status **in_progress (implementation/tests ready; held for Pack 1)**. Removes sample events, placeholder fields and current-time substitution; uses recorded actor/time evidence. 14 new handler tests pass on Node 22.16.0 and 24.19.0. [Platform Web](https://github.com/johnniemarbles/expadio/actions/runs/33356259998) passed typecheck, 359 tests and Next build; [Workflow Integration](https://github.com/johnniemarbles/expadio/actions/runs/33356260001) passed 67 PostgreSQL integration tests. Local regression run before changes had 7 failures / 3 passes.
  - Pack 3: owner ChatGPT; branch `fix/audit-scope-copy-pack3`; [draft PR #480](https://github.com/johnniemarbles/expadio/pull/480), head `ac2b33c4a687cfd9cb5a1692727ea1f2fb04fc4f`; status **in_progress (implementation/checks ready; held for Packs 1–2)**. One-line conditional uses the banner's source kind. Four controlled local page-render checks passed (live empty, fixture empty, populated, denied). [Platform Web](https://github.com/johnniemarbles/expadio/actions/runs/33356280367) passed typecheck, 345 tests and build; [Workflow Integration](https://github.com/johnniemarbles/expadio/actions/runs/33356280334) passed.
  - Both drafts preserve their independent scopes and must remain unmerged until Pack 1 is resolved and the stated sequence is satisfied. Neither changes production deployment or permits a live test send.

### Pack 1 prerequisite scope — decision requested, NOT Accepted

**Why the original scope is insufficient (pinned source `89d3056`):**

1. `apps/platform-web/lib/request-context.ts` defaults missing selection to demo tenant/org; `requestedOrganizationId()` returns the demo organization unconditionally. `live-adapter.ts` uses `organizationId` in the activity URL while the resolver recognizes `org`; activity ignores the requested organization.
2. `apps/platform-web/lib/iam-adapter.ts` supplies `AutoProvisioningMembershipRepository`, whose membership read may insert/reactivate demo membership and ensure admin grants. `admin-grant.ts` defaults `DEMO_OPEN_ADMIN` to true. This is source/default behavior; deployment environment values were not inspected. A request denial must not first create membership/privilege side effects.
3. Migrations `0026_agent_run_history.sql` and `0035_sensitive_read_history.sql`, plus their `packages/postgres-runtime/src/agent-run.ts` and `sensitive-read-event.ts` writers, have tenant-only history with no durable organization provenance. Current actor membership is not historical resource ownership and cannot safely backfill it.
4. `withTenantClient` applies a transaction-local tenant GUC without an explicit transaction; Pack 1 should use the existing `withTenantTransaction` for protected reads. Membership verification alone is not proof of authorization to every event/resource within that tenant.

**Proposed bounded prerequisite authorization:**

- **Live identity/context hardening:** repair the existing context and propagation path; remove implicit live demo selection; fail closed on missing, malformed or conflicting scope. Use persisted membership verification without auto-provisioning or admin-grant writes during reads. Keep any explicitly approved demo bootstrap outside live request resolution; preserve the auth provider and canonical IAM engine. Scope: existing `request-context.ts`, `iam-adapter.ts`, `admin-grant.ts`, and only necessary existing proxy/adapter propagation callers, plus focused behavioral tests.
- **Audit organization/resource provenance:** authorize one forward migration and the existing agent-run/sensitive-read contracts and writers to record trusted scope at event creation, with tenant/organization integrity constraints. Preserve append-only history; never assign a guessed organization to legacy rows. Unknown-scope historical rows must not appear in an organization-scoped timeline. Wire the existing activity endpoint through validated context, existing authorization and a tenant transaction; reuse canonical audit storage rather than creating a competing engine.
- **Acceptance:** no-session/no-selection/forged-tenant/wrong-org/out-of-scope-resource requests deny before protected reads or provisioning writes; two organizations within one tenant cannot read each other's evidence; verify RLS as a non-owner/non-bypass role; pooled connection reuse cannot carry another request's scope; matching authorized real rows remain visible; legacy unknown-scope rows are excluded without fabricating replacement events; typecheck, app build and relevant PostgreSQL integration tests pass.
- **Not authorized by this proposed scope:** second vertical/product depth, direct AI business mutation, new audit/workflow engines, retrospective guessed history, real provider sends, freeze/checklist release changes, or CI bypass.
- This is a concrete scope decision for the human owner/independent collaboration review, not self-acceptance or permission to amend the original pack silently.

### Strategy proof evidence found during this execution

- Existing `apps/platform-web/test-integration/dentex-discharge-followup-action.itest.ts` passed in #479's 67-test integration run. Exact mapping: `Treatment.Discharged` → `dentex.treatment.discharge.patient-follow-up` → `patient.follow_up.schedule` (604800 seconds) → `COMMUNICATE / patient.follow_up`, with the existing `dentex.treatment.discharge.follow-up-review-task` sibling intent.
- This test seeds its tenant/configuration, injects a simulated Resend response, invokes the trusted verified-webhook ingester directly, and checks provider/delivery trace evidence. It does not prove HTTP session authorization, webhook signature verification, real Resend delivery, Audit-page correlation, or a full leased outbox-worker-to-provider run. Do not label it live proof.
- [PR #444](https://github.com/johnniemarbles/expadio/pull/444), head `dd3884755d295efb78bb41ce1b1d83aff6946e2d`, provides recovery schema and read-only queue API, not executable retry/cancel/escalation. Its GET path uses `withTenantClient`, filters by tenant, and exposes payload/claim fields without demonstrated organization/resource authorization. Its smoke isolation assertions use explicit predicates under migration-owner access, not proof of RLS enforcement. Preserve this work; complete scoped authorization/transaction and runtime recovery tests before claiming strategy acceptance.
- `packages/agent-runtime/src/approval.ts` already rejects self-approval, tenant/proposal mismatch and rejection. Main's `packages/governed-actions/src/ai-action-executor.ts` still labels high-confidence output auto-approved; [PR #475](https://github.com/johnniemarbles/expadio/pull/475) already removes that behavior and keeps proposals unapproved. Do not duplicate that change or equate proposal generation with an enforced business-action handoff. Brain corrections GET still contains demo context/sample output; it is outside these Audit packs and needs separately scoped follow-up.

- **2026-08-31 — Human approval of Pack 1 prerequisite scope.** Sanjeev Sood explicitly replied “you are approved” to the concrete IAM and audit-provenance prerequisite request above. This authorizes the bounded live context/provenance implementation and behavioral tests exactly as recorded; it does not authorize live provider sends, vertical depth, new engines, guessed legacy backfill, CI bypass, or release-gate changes.
  - Executor claim: owner ChatGPT; pack `AUDIT-SCOPE-PREREQ + Pack 1`; branch `fix/audit-live-context-pack1`; pr TBD; status `in_progress`; baseline `50326320d262f3f2d9925dae4e340a59ec7d8d3d`.
