BEGIN;

-- Gate 3 remainder — task priority, escalation, and org-level SLA configuration.
--
-- Priority drives SLA targets. Escalation is stamped explicitly by operators
-- (or a background process) when a task breaches its target window. The SLA
-- config table lets each org tune hours-to-target / hours-to-escalation per
-- priority tier.

ALTER TABLE platform.lead_tasks
  ADD COLUMN priority text NOT NULL DEFAULT 'MEDIUM'
    CHECK (priority IN ('LOW','MEDIUM','HIGH','URGENT')),
  ADD COLUMN escalated_at timestamptz;

-- Composite index for escalation sweeps (find open tasks past due).
CREATE INDEX lead_tasks_escalation_idx
  ON platform.lead_tasks (tenant_id, organization_id, priority, due_at)
  WHERE status = 'OPEN' AND due_at IS NOT NULL;

-- Org-level SLA target configuration.
-- target_hours: operator must act within this window.
-- escalation_hours: task is auto-escalatable after this many hours past due_at.
CREATE TABLE platform.lead_task_sla_config (
  tenant_id       uuid    NOT NULL,
  organization_id uuid    NOT NULL,
  priority        text    NOT NULL CHECK (priority IN ('LOW','MEDIUM','HIGH','URGENT')),
  target_hours    integer NOT NULL CHECK (target_hours > 0),
  escalation_hours integer NOT NULL CHECK (escalation_hours >= target_hours),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, organization_id, priority),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
);

ALTER TABLE platform.lead_task_sla_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.lead_task_sla_config FORCE ROW LEVEL SECURITY;

CREATE POLICY lead_task_sla_config_org ON platform.lead_task_sla_config
  USING (
    tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  )
  WITH CHECK (
    tenant_id = platform.current_tenant_id()
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  );

-- Stable SLA status for a single task row — used in API response shaping.
CREATE OR REPLACE FUNCTION platform.lead_task_sla_status(
  p_status       text,
  p_due_at       timestamptz,
  p_escalated_at timestamptz
) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_status <> 'OPEN'               THEN 'N/A'
    WHEN p_escalated_at IS NOT NULL        THEN 'ESCALATED'
    WHEN p_due_at IS NULL                  THEN 'ON_TRACK'
    WHEN p_due_at < now()                  THEN 'OVERDUE'
    WHEN p_due_at < now() + INTERVAL '24 hours' THEN 'AT_RISK'
    ELSE 'ON_TRACK'
  END
$$;

COMMIT;
