BEGIN;

-- Neutral tenant work kernel: customer follow-ups and reviewable work.
-- Domain-specific packs reference these rows; they do not fork execution.
CREATE TABLE platform.tenant_work_items (
  work_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  organization_id uuid,
  location_id uuid,
  subject_type text NOT NULL CHECK (btrim(subject_type) <> ''),
  subject_id uuid,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  work_type text NOT NULL CHECK (btrim(work_type) <> ''),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','AWAITING_REVIEW','APPROVED','SCHEDULED','QUEUED','SENT','DELIVERED','FAILED','OUTCOME_UNCERTAIN','CANCELLED')),
  maker_subject_id text,
  assignee_subject_id text,
  due_at timestamptz,
  correlation_id text NOT NULL UNIQUE,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE platform.tenant_follow_ups (
  follow_up_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  work_item_id uuid NOT NULL REFERENCES platform.tenant_work_items(work_item_id) ON DELETE CASCADE,
  customer_id uuid,
  scheduled_for timestamptz,
  channel text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','AWAITING_REVIEW','APPROVED','SCHEDULED','QUEUED','SENT','DELIVERED','FAILED','OUTCOME_UNCERTAIN','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, work_item_id)
);

ALTER TABLE platform.tenant_work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenant_work_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_work_items_tenant_isolation ON platform.tenant_work_items
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
ALTER TABLE platform.tenant_follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenant_follow_ups FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_follow_ups_tenant_isolation ON platform.tenant_follow_ups
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE INDEX tenant_work_items_queue_idx ON platform.tenant_work_items (tenant_id, status, due_at);
CREATE INDEX tenant_follow_ups_queue_idx ON platform.tenant_follow_ups (tenant_id, status, scheduled_for);

COMMIT;
