# Agent Runtime Tool Selection (Task-Level Agent Bounds)

**Proposed by:** Claude
**Date:** 2026-09-07
**Status:** Open
**Related area:** packages/agent-runtime/src/core/mission-tools.ts, platform.agent_definitions, platform.agent_tasks

## Problem / Opportunity

Following the extraction of the shared mission tool registry and the enforcement of `platform.tenant_tool_grants`, we have secured tool access at the **tenant level**. 

However, at the **task execution level**, there is currently no check enforcing that an agent only uses tools within its declared capabilities. A task could technically invoke any tool the tenant has access to, regardless of which agent was assigned the task.

While `isAgentActive(tenantId, agentSlug)` already serves as a **planning-time gate** (verifying a tenant possesses all grants required by an agent before assigning a task), we lack a **dispatch-time gate** in the executor's `authorize()` path to restrict the agent to its specific subset of tools.

## Proposal

1. **Check-Time Filtering in `authorize()`:** Rather than modifying the registered tools at construction time, the `authorize` port will evaluate `query.assignedAgentId` on every invocation. 
2. **Shared Taxonomy:** Use the existing `TOOL_GROUP_MAPPING` to resolve the requested `toolKey` into its coarse group (e.g., `revenue.lead.osint` -> `DB`).
3. **Agent Bounds Check:** If the tool is not `EXEMPT`, query `platform.agent_definitions` where `slug = query.assignedAgentId` and verify the resolved coarse group is present in the agent's `tools` JSON array.
4. **Fail-Closed for Unassigned Tasks:** If `query.assignedAgentId` is null or missing, the authorization port must **fail closed** (deny the invocation) for any non-`EXEMPT` tool. Only foundational capabilities (like `cbos.context.observe`) can run without an assigned agent identity.

## Architectural Clarifications

- **Planning-Time vs. Execution-Time:** This proposal does not replace `isAgentActive`. `isAgentActive` remains the planning-time gate to ensure the tenant is fully provisioned for an agent. This new check is the execution-time gate ensuring the agent doesn't exceed its own bounds during a task.
- **Slug Lookup:** `assigned_agent_id` on tasks stores the human-readable agent `slug` (e.g., `pipeline-health-analyst`), not the UUID. The lookup in `authorize()` must match this convention.
- **Technical Debt Flag:** `assigned_agent_id` is a text column without a foreign key constraint to `agent_definitions.slug`. This means it can silently hold an invalid slug. This ADR does not prescribe fixing the schema constraint, but notes it as a data integrity gap.

## Expected benefits
- Enforces strict least-privilege per task based on the assigned persona's declared tools.
- Prevents agents from silently inheriting global tenant access to unrelated tools.

## Decision trail
- **2026-09-07** — Drafted and Opened.
