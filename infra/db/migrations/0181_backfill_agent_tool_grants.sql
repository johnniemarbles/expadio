-- Backfill DB and Comms tool grants for tenants that have active revenue or voice agents
-- This prevents a hard-cutover breakage for existing active agent bindings when the runtime authorization enforcement goes live.

WITH active_target_tenants AS (
    SELECT DISTINCT b.tenant_id
    FROM platform.tenant_agent_bindings b
    JOIN platform.agent_definitions a ON a.agent_id = b.agent_id
    WHERE b.status = 'ACTIVE'
      AND (
          a.department ILIKE '%revenue%' OR 
          a.department ILIKE '%voice%' OR 
          a.slug ILIKE '%revenue%' OR 
          a.slug ILIKE '%voice%'
      )
)
INSERT INTO platform.tenant_tool_grants (tenant_id, tool_group, enabled, updated_at)
SELECT tenant_id, 'DB', true, NOW()
FROM active_target_tenants
ON CONFLICT (tenant_id, tool_group) DO UPDATE 
SET enabled = true, updated_at = NOW();

WITH active_target_tenants AS (
    SELECT DISTINCT b.tenant_id
    FROM platform.tenant_agent_bindings b
    JOIN platform.agent_definitions a ON a.agent_id = b.agent_id
    WHERE b.status = 'ACTIVE'
      AND (
          a.department ILIKE '%revenue%' OR 
          a.department ILIKE '%voice%' OR 
          a.slug ILIKE '%revenue%' OR 
          a.slug ILIKE '%voice%'
      )
)
INSERT INTO platform.tenant_tool_grants (tenant_id, tool_group, enabled, updated_at)
SELECT tenant_id, 'Comms', true, NOW()
FROM active_target_tenants
ON CONFLICT (tenant_id, tool_group) DO UPDATE 
SET enabled = true, updated_at = NOW();
