BEGIN;

-- ─── Agent Missions ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS platform.agent_missions (
  mission_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  user_subject_id text NOT NULL CHECK (btrim(user_subject_id) <> ''),
  intent text NOT NULL CHECK (btrim(intent) <> ''),
  status text NOT NULL DEFAULT 'PLANNING' CHECK (
    status IN ('PLANNING', 'IN_PROGRESS', 'AWAITING_APPROVAL', 'COMPLETED', 'FAILED')
  ),
  summary jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_missions_tenant_status ON platform.agent_missions(tenant_id, status);

ALTER TABLE platform.agent_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.agent_missions FORCE ROW LEVEL SECURITY;

CREATE POLICY agent_missions_select ON platform.agent_missions
  FOR SELECT USING (tenant_id = platform.current_tenant_id());

CREATE POLICY agent_missions_insert ON platform.agent_missions
  FOR INSERT WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY agent_missions_update ON platform.agent_missions
  FOR UPDATE USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

-- ─── Agent Tasks ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS platform.agent_tasks (
  task_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES platform.agent_missions(mission_id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  assigned_agent_id text NOT NULL CHECK (btrim(assigned_agent_id) <> ''),
  title text NOT NULL CHECK (btrim(title) <> ''),
  description text NOT NULL DEFAULT '',
  action_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  depends_on jsonb NOT NULL DEFAULT '[]'::jsonb,
  requires_approval boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (
    status IN ('QUEUED', 'RUNNING', 'AWAITING_APPROVAL', 'COMPLETED', 'FAILED')
  ),
  output_artifact jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_tasks_mission ON platform.agent_tasks(mission_id);
CREATE INDEX idx_agent_tasks_tenant_status ON platform.agent_tasks(tenant_id, status);

ALTER TABLE platform.agent_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.agent_tasks FORCE ROW LEVEL SECURITY;

CREATE POLICY agent_tasks_select ON platform.agent_tasks
  FOR SELECT USING (tenant_id = platform.current_tenant_id());

CREATE POLICY agent_tasks_insert ON platform.agent_tasks
  FOR INSERT WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY agent_tasks_update ON platform.agent_tasks
  FOR UPDATE USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

-- ─── Agent Approval Requests ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS platform.agent_approval_requests (
  approval_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES platform.agent_missions(mission_id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES platform.agent_tasks(task_id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  title text NOT NULL CHECK (btrim(title) <> ''),
  description text NOT NULL DEFAULT '',
  staged_changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'APPROVED', 'REJECTED')
  ),
  telegram_message_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX idx_agent_approval_requests_mission ON platform.agent_approval_requests(mission_id);
CREATE INDEX idx_agent_approval_requests_tenant_status ON platform.agent_approval_requests(tenant_id, status);

ALTER TABLE platform.agent_approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.agent_approval_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY agent_approval_requests_select ON platform.agent_approval_requests
  FOR SELECT USING (tenant_id = platform.current_tenant_id());

CREATE POLICY agent_approval_requests_insert ON platform.agent_approval_requests
  FOR INSERT WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY agent_approval_requests_update ON platform.agent_approval_requests
  FOR UPDATE USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

-- ─── Agent Tenant Memory ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS platform.agent_tenant_memory (
  memory_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  memory_key text NOT NULL CHECK (btrim(memory_key) <> ''),
  memory_value jsonb NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_tenant_memory_unique_key UNIQUE (tenant_id, memory_key)
);

CREATE INDEX idx_agent_tenant_memory_tenant ON platform.agent_tenant_memory(tenant_id);

ALTER TABLE platform.agent_tenant_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.agent_tenant_memory FORCE ROW LEVEL SECURITY;

CREATE POLICY agent_tenant_memory_select ON platform.agent_tenant_memory
  FOR SELECT USING (tenant_id = platform.current_tenant_id());

CREATE POLICY agent_tenant_memory_insert ON platform.agent_tenant_memory
  FOR INSERT WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY agent_tenant_memory_update ON platform.agent_tenant_memory
  FOR UPDATE USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
