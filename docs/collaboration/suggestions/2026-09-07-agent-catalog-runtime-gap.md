# Agent Catalog Is Disconnected From Mission Runtime (Tools, Authorization, and Duplication)

**Proposed by:** Claude
**Date:** 2026-09-07
**Status:** Implemented
**Related area:** apps/platform-web/app/api/agent/missions/route.ts, apps/brand-web/app/api/brain/missions/route.ts, packages/agent-runtime/src/, platform.agent_definitions, platform.tenant_tool_grants

## Problem / Opportunity

While piloting an import of an external persona (`SKILL_pipeline_health_analyst.md` → `platform.agent_definitions`), tracing the real execution path surfaced three related gaps between the agent *catalog* (what tenants see and bind to) and the mission *runtime* (what actually executes). Each is small in isolation; together they mean creating a new `agent_definitions` row currently has no effect on real agent behavior.

### 1. `agent_definitions.tools` is not read by the mission executor

`POST /api/agent-definitions` lets you declare an agent's `tools` (coarse groups: `GitHub`, `FS`, `DB`, `Audit`, `Comms`, matched against `platform.tenant_tool_grants.tool_group`). This field is used in one place: the "ready agents" readiness query in the missions `GET` handler, purely for display.

It is never read when a mission actually runs. Both `apps/platform-web/app/api/agent/missions/route.ts` and `apps/brand-web/app/api/brain/missions/route.ts` construct a **fixed, hardcoded `registeredTools` array** on every `POST`, identical regardless of which agent/persona is involved:

```ts
const registeredTools = [
  contextObserveTool,
  createStubTool('content.editorial.debate'),
  createStubTool('revenue.lead.osint'),
  createStubTool('revenue.outreach.draft_sequence'),
  createStubTool('voice.callback.prepare'),
];
```

There is no code path connecting a `platform.agent_definitions` row (or a `platform.tenant_agent_bindings` binding) to which tools get registered for a given mission. An agent's declared `tools` array is decorative today.

### 2. Four of five registered tools are stubs; the authorization port doesn't check tenant grants

Of the five tools above, only `cbos.context.observe` has a real implementation. `revenue.lead.osint` is stubbed via `createStubTool()` despite a complete, real adapter already existing at `packages/agent-runtime/src/committees/lead-osint-tool.ts` (`createLeadOsintTool`, with proper `LeadOsintPort`/`LeadTargetResolver`/`LeadArtifactStore` interfaces) — it's built but not wired into either mission route. The other two (`revenue.outreach.draft_sequence`, `voice.callback.prepare`) also have real adapter files under `committees/` that appear unused here.

Separately, the `authorizationPort` implemented inline in both routes does not consult `platform.tenant_tool_grants` at all:

```ts
async authorize(query) {
  if (query.tenantId !== context.tenantId) return { allowed: false, reasonKey: 'TENANT_MISMATCH' };
  if (query.effect === 'PROPOSE') return { allowed: false, reasonKey: 'PROPOSE_REQUIRES_POLICY' };
  return { allowed: true, reasonKey: 'TENANT_SCOPED_OBSERVE_ALLOWED' };
}
```

It checks tenant match and blanket-denies any `PROPOSE` effect. Any registered `OBSERVE` tool is currently invocable by any authenticated user of a tenant, regardless of what that tenant has or hasn't granted in `tenant_tool_grants`. The grants table is real and populated in the readiness display but has no enforcement role at invocation time.

### 3. The gap is duplicated, not centralized

`apps/brand-web`'s copy of this route is not an independent implementation — it is a near-verbatim duplicate of `apps/platform-web`'s (same tool list, same stub factory including matching non-standard indentation, same authorization logic). There is no shared module either file calls; each constructs its own `registeredTools`/`authorizationPort` inline. A fix applied to one will silently not apply to the other unless done deliberately in both, or extracted into a shared function first.

## Proposal

1. **Extract tool-registry + authorization-port construction into a shared function** in `packages/agent-runtime` (or a new small package), parameterized by tenant context, and have both `apps/platform-web` and `apps/brand-web` mission routes call it instead of each defining their own. This removes the duplication risk before anything else changes.
2. **Wire the real committee tool adapters in place of the stubs** (`createLeadOsintTool`, and the equivalents for `revenue.outreach.draft_sequence` and `voice.callback.prepare`, if those adapters exist under `committees/` and are similarly unused) — with their required ports (`LeadOsintPort`, `LeadTargetResolver`, `LeadArtifactStore`, etc.) properly implemented, not left as stubs.
3. **Enforce `platform.tenant_tool_grants` in the authorization port**, so `authorize()` actually denies a tool invocation when the tenant hasn't granted the relevant `tool_group`, rather than only checking tenant match and blanket-blocking `PROPOSE`.
4. **Connect `agent_definitions.tools` to the runtime tool selection** for a mission — e.g., when a mission task is assigned to a specific `agent_id`, the executor's registered-tools set should be filtered/derived from that agent's declared `tools`/capabilities, not from a global fixed list. Exact mechanism (task-level agent binding → tool subset resolution) needs design; this suggestion flags the requirement rather than prescribing the implementation.

## Expected benefits

- Creating an `agent_definitions` row (e.g., for a converted external persona) will actually change runtime behavior, not just catalog/display state
- `tenant_tool_grants` becomes a real enforcement boundary instead of a display-only readiness signal
- Real, already-built tool adapters (lead OSINT, outreach draft, voice callback) get used instead of sitting unused behind stubs
- Removes the platform-web/brand-web drift risk before it causes a real divergence (one app with working tools, the other still stubbed)

## Risks / trade-offs

- This is runtime/authorization code, not documentation — higher review bar and test coverage needed than prior suggestions in this thread
- Enforcing `tenant_tool_grants` at invocation time may immediately deny tools currently working for tenants who were never explicitly granted them (since nothing enforces this today) — needs a rollout plan (e.g., backfill grants for currently-active bindings) rather than a hard cutover
- Connecting `agent_definitions.tools` to runtime tool selection touches the core mission execution path (`ChiefOfStaffOrchestrator`, `GovernedTaskExecutor`) — larger blast radius than the flat-file skill manifest work that prompted this suggestion
- Wiring real adapters (e.g., `LeadOsintPort`) may surface that their required dependencies (external OSINT data source, artifact store) aren't fully implemented elsewhere yet — scope may expand once attempted

## Implementation notes

- Suggested split for executor claim: (1) shared registry extraction + de-duplication first, as a safe, low-risk refactor; (2) grants enforcement in authorization port, with a backfill/rollout step; (3) real adapter wiring per tool, likely one PR per tool given differing dependency readiness; (4) `agent_definitions.tools` → runtime selection, as the largest and most design-dependent piece, probably deserving its own follow-up ADR rather than being bundled into this suggestion's implementation.
- This suggestion should be resolved (or at least items 1–3 substantially addressed) before items 1-3 substantially addressed before importing further external personas into `agent_definitions`, since additional catalog entries don't currently produce additional real behavior.

## Decision trail

- **2026-09-07** — Proposed by Claude (chat session, no direct repo write access — human or a connected agent must land this file per `CONNECTING-AGENTS.md`).
- **2026-09-07** — Implementation started while suggestion was still Open, bypassing independent review. Resulted in a missing backfill and an unreviewed tool mapping (`cbos.context.observe` -> `Audit`).
- **2026-09-07** — Retroactive review conducted during PR phase (`feat/agent-catalog-runtime-refactor`). Identified governance failure, fixed the mapping (introducing `EXEMPT` in code for cognitive/context tools), and added a backfill migration (`0181_backfill_agent_tool_grants.sql`) targeting active `revenue` and `voice` bindings. Status updated to Implemented (Retroactively Reviewed).
