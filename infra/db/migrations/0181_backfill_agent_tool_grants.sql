-- Backfill DB and Comms tool grants for active tenants to prevent hard-cutover breakage.
-- Scoped strictly to the specific tool group needed by the tenant's active agents.

-- 1. DB Grant: Only for tenants with agents that use revenue.lead.osint (revenue department)
WITH db_target_tenants AS (
    SELECT DISTINCT b.tenant_id
    FROM platform.tenant_agent_bindings b
    JOIN platform.agent_definitions a ON a.agent_id = b.agent_id
    WHERE b.status = 'ACTIVE'
      AND (a.department ILIKE '%revenue%' OR a.slug ILIKE '%revenue%')
)
INSERT INTO platform.tenant_tool_grants (tenant_id, tool_group, enabled, updated_at)
SELECT tenant_id, 'DB', true, NOW()
FROM db_target_tenants
ON CONFLICT (tenant_id, tool_group) DO UPDATE 
SET enabled = true, updated_at = NOW();

-- 2. Comms Grant: For tenants with agents that use revenue.outreach.draft_sequence OR voice.callback.prepare
WITH comms_target_tenants AS (
    SELECT DISTINCT b.tenant_id
    FROM platform.tenant_agent_bindings b
    JOIN platform.agent_definitions a ON a.agent_id = b.agent_id
    WHERE b.status = 'ACTIVE'
      AND (
          a.department ILIKE '%revenue%' OR a.slug ILIKE '%revenue%' OR
          a.department ILIKE '%voice%' OR a.slug ILIKE '%voice%'
      )
)
INSERT INTO platform.tenant_tool_grants (tenant_id, tool_group, enabled, updated_at)
SELECT tenant_id, 'Comms', true, NOW()
FROM comms_target_tenants
ON CONFLICT (tenant_id, tool_group) DO UPDATE 
SET enabled = true, updated_at = NOW();
