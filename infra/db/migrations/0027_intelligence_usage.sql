BEGIN;

CREATE TABLE platform.intelligence_usage_events (
  event_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL
    REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  organization_id uuid,
  meter text NOT NULL CHECK (meter IN (
    'AI_REQUEST',
    'AI_INPUT_TOKEN',
    'AI_OUTPUT_TOKEN',
    'VOICE_MILLISECOND',
    'AGENT_TOOL_STEP'
  )),
  quantity bigint NOT NULL CHECK (quantity >= 0),
  cost_minor_units bigint NOT NULL CHECK (cost_minor_units >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  capability_key text NOT NULL CHECK (btrim(capability_key) <> ''),
  connector_key text NOT NULL CHECK (btrim(connector_key) <> ''),
  provider_key text NOT NULL CHECK (btrim(provider_key) <> ''),
  model_key text,
  provider_cost_ownership text NOT NULL CHECK (
    provider_cost_ownership IN (
      'EXPADIO_MANAGED', 'BYOK', 'CUSTOMER_PROVIDER'
    )
  ),
  work_reference text NOT NULL CHECK (btrim(work_reference) <> ''),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  correlation_id uuid NOT NULL,
  evidence_refs text[] NOT NULL CHECK (
    cardinality(evidence_refs) > 0
    AND array_position(evidence_refs, NULL) IS NULL
  ),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
);

CREATE INDEX intelligence_usage_scope_period_idx
  ON platform.intelligence_usage_events (
    tenant_id, organization_id, currency, occurred_at
  );

CREATE INDEX intelligence_usage_work_idx
  ON platform.intelligence_usage_events (
    tenant_id, work_reference, occurred_at
  );

CREATE OR REPLACE FUNCTION platform.reject_intelligence_usage_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Intelligence usage history is immutable';
END;
$$;

CREATE TRIGGER intelligence_usage_events_immutable
BEFORE UPDATE OR DELETE ON platform.intelligence_usage_events
FOR EACH ROW EXECUTE FUNCTION platform.reject_intelligence_usage_mutation();

ALTER TABLE platform.intelligence_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.intelligence_usage_events FORCE ROW LEVEL SECURITY;

CREATE POLICY intelligence_usage_events_select
  ON platform.intelligence_usage_events
  FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE POLICY intelligence_usage_events_insert
  ON platform.intelligence_usage_events
  FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
