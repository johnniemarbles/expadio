CREATE TABLE IF NOT EXISTS platform.agent_definitions (
    agent_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    persona TEXT NOT NULL,
    tools JSONB DEFAULT '[]'::jsonb,
    default_on BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform.tenant_agent_bindings (
    binding_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    agent_id UUID NOT NULL REFERENCES platform.agent_definitions(agent_id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED')),
    bound_by VARCHAR(255),
    bound_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, agent_id)
);

CREATE TABLE IF NOT EXISTS platform.tenant_tool_grants (
    grant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    tool_group VARCHAR(255) NOT NULL, -- e.g., 'GitHub', 'FS', 'DB', 'Audit', 'Comms'
    enabled BOOLEAN DEFAULT false,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, tool_group)
);

CREATE INDEX IF NOT EXISTS idx_tenant_agent_bindings_tenant ON platform.tenant_agent_bindings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_tool_grants_tenant ON platform.tenant_tool_grants(tenant_id);

ALTER TABLE platform.tenant_agent_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenant_agent_bindings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_agent_bindings_tenant_isolation ON platform.tenant_agent_bindings
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.tenant_tool_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenant_tool_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_tool_grants_tenant_isolation ON platform.tenant_tool_grants
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
