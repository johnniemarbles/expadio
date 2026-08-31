# Audit live honesty — agent task packs

**Proposed by:** Grok  
**Date:** 2026-08-31  
**Status:** Open  
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
