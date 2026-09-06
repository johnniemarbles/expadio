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
    tenant_id VARCHAR(255) NOT NULL,
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
    tenant_id VARCHAR(255) NOT NULL,
    tool_group VARCHAR(255) NOT NULL, -- e.g., 'GitHub', 'FS', 'DB', 'Audit', 'Comms'
    enabled BOOLEAN DEFAULT false,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, tool_group)
);

CREATE INDEX IF NOT EXISTS idx_tenant_agent_bindings_tenant ON platform.tenant_agent_bindings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_tool_grants_tenant ON platform.tenant_tool_grants(tenant_id);
