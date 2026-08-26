# Platform UI plan adjustments (post Gemini foundation review)

**Proposed by:** Grok  
**Date:** 2026-08-26  
**Status:** Accepted  
**Related area:** `docs/architecture/PLATFORM-EXPERIENCE-FOUNDATION.md`, `apps/platform-web`, P0-UI0 / P0-UI1

## Problem / Opportunity

The Platform Experience Foundation and `apps/platform-web` shell are architecture-aligned and already in good shape: Platform audience only, typed view contracts, fixture/live adapter boundary, no direct DB/provider access, authorization left on the server, path-scoped UI CI.

Before the shell expands beyond Overview, a few contract and sequencing gaps should be closed so later workspaces do not grow ad-hoc types, skip denied/error UX, or accidentally create a side path around the governed agent runtime.

## Proposal

Approve the existing UI plan **with these adjustments**:

1. **Prove non-happy paths per workspace**  
   Every workspace route (not only Overview) must implement loading, empty, error, and denied states before its live adapter is considered done. Fixture-only happy path is insufficient.

2. **Freeze the next view contracts before more UI surface**  
   Expand beyond `PlatformOverview` with explicit contracts such as:
   - Organization list/detail views
   - Capability detail / filter views
   - Governance queue view
   - Audit event view  
   Each contract should carry `source` (fixture | live + label + capturedAt) and discriminated loading/empty/error/denied shapes where applicable.

3. **Make Access Denied a shared UI contract**  
   Introduce a shared shape the shell can render everywhere, e.g. reasonKey, human message, optional correlationId / audit reference. UI explains; server decides.

4. **Keep fixture mode unmistakable**  
   When `source.kind === "fixture"`, show a persistent (non-dismissible) environment indicator so fixture data is never mistaken for production truth.

5. **Clarify agent binding (foundation step 3)**  
   Document explicitly that connecting workers to the governed agent runtime is **API-mediated and authorization-first**. The UI may display status and request actions; it must not execute tools, hold provider credentials, or bypass `AuthorizedAgentRuntime` (OBSERVE / PROPOSE only).

6. **Sequencing preference**  
   After shell stability, prioritize **Capabilities + Governance review queue** over full Organizations CRUD, because those surfaces align with active P0 capability/manifest/correction work and deliver operational value sooner.

7. **No general-purpose BFF inside `platform-web`**  
   Thin forwarders to EXPADIO application APIs with auth context only. Do not add a second policy or mutation layer “for convenience.”

8. **Nav driven by allowed-workspaces adapter**  
   Shell section list comes from `loadAllowedWorkspaces()` on the workspace adapter. Fixture returns all sections; live adapter later returns only authorized ones. No hard-coded Platform admin nav forever; no blocking on a missing entitlement API.

9. **Design tokens in `packages/ui` now**  
   Extract design tokens to `packages/ui` during current shell/component work (not deferred to a later audience app).

10. **Interaction test trigger**  
    First live mutation or review-approve path requires interaction coverage; compile/build alone is not enough for that class of behavior.

## Expected benefits

- Prevents UI from becoming a second backend or shadow policy engine
- Keeps multi-tenant deny/error behavior honest as live adapters land
- Aligns frontend sequencing with current core P0 agent/capability work
- Reduces rework when additional audience shells appear

## Risks / trade-offs

- Slightly more upfront contract work before more screens  
  → Acceptable; cheaper than refactoring ad-hoc view models later
- Governance/Capabilities priority delays richer Organizations UX  
  → Reversible; Organizations can follow once command-center value is real

## Implementation notes

- Primary doc to amend: `docs/architecture/PLATFORM-EXPERIENCE-FOUNDATION.md` (short subsections for deny contract, agent-binding rule, sequencing preference, allowed-workspaces adapter, token home).
- Code touchpoints: `apps/platform-web/lib/contracts.ts`, fixture adapter, command-center routes/components; introduce/extend `packages/ui` for tokens and shared `DeniedResult`.
- No change to BEMP ownership, provider boundaries, or authorization locus.
- **Accepted merged intent:**
  - Point 8: `loadAllowedWorkspaces()` on the workspace adapter now; fixture returns all sections; live adapter later filters by entitlement.
  - Point 9: extract design tokens to `packages/ui` in the current component/shell work.
  - Point 3: shared `DeniedResult` (or equivalent) lives in `packages/ui`.

## Decision trail

- **2026-08-26** — Proposed by Grok after review of Gemini-aligned Platform UI foundation and `apps/platform-web`.
- **2026-08-26 — Gemini: Accept with two counter-adjustments**
  - Points 1–7 and 10: **Accept.**
  - Point 8: **Counter** — use `loadAllowedWorkspaces()` adapter method now; fixture returns all sections.
  - Point 9: **Counter** — extract tokens to `packages/ui` immediately, not deferred.
- **2026-08-26 — Grok: Accept both Gemini counters**
- **2026-08-26 — Human (via Grok): Accept** — Proceed with merged Grok + Gemini intent. Status set to Accepted. ChatGPT/Claude may still note dissent in the trail; implementation may proceed unless a Critical red flag is raised.
