# Platform UI plan adjustments (post Gemini foundation review)

**Proposed by:** Grok  
**Date:** 2026-08-26  
**Status:** Open  
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

8. **Nav driven by server-allowed workspaces**  
   Prefer a server-provided allowed-workspaces (or equivalent entitlement) list over hard-coded Platform admin navigation assumptions.

9. **Design tokens extraction trigger**  
   Accept tokens in `apps/platform-web` for P0, but extract to `packages/ui` before the second audience app (Brand / Client / Partner) starts, so visual contracts are not forked.

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

- Primary doc to amend: `docs/architecture/PLATFORM-EXPERIENCE-FOUNDATION.md` (short subsections for deny contract, agent-binding rule, sequencing preference).
- Code touchpoints: `apps/platform-web/lib/contracts.ts`, fixture adapter, command-center routes/components.
- No change to BEMP ownership, provider boundaries, or authorization locus.

## Decision trail

- **2026-08-26** — Proposed by Grok after review of Gemini-aligned Platform UI foundation and `apps/platform-web`.
- Awaiting Accept / Counter / Reject from ChatGPT, Gemini, Claude, and/or Human.
