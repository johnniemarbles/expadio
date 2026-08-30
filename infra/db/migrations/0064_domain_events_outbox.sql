BEGIN;

-- Domain Event + Transactional Outbox
--
-- Domain events are immutable business facts. Outbox rows are separate mutable
-- delivery records. A business mutation, its event, and the outbox insert must
-- be committed in one transaction by the application service.

CREATE TABLE platform.domain_events (
  event_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  aggregate_type text NOT NULL CHECK (btrim(aggregate_type) <> ''),
  aggregate_id text NOT NULL CHECK (btrim(aggregate_id) <> ''),
  event_type text NOT NULL CHECK (btrim(event_type) <> ''),
  event_version integer NOT NULL CHECK (event_version > 0),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_subject_id text NOT NULL CHECK (btrim(actor_subject_id) <> ''),
  correlation_id text NOT NULL CHECK (btrim(correlation_id) <> ''),
  causation_id text,
  pack_key text,
  pack_version integer,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (event_id, tenant_id),
  CHECK (pack_version IS NULL OR pack_version > 0),
  CHECK (pack_version IS NULL OR (pack_key IS NOT NULL AND btrim(pack_key) <> ''))
);

CREATE INDEX domain_events_aggregate_idx
  ON platform.domain_events (
    tenant_id,
    aggregate_type,
    aggregate_id,
    occurred_at,
    event_id
  );

CREATE INDEX domain_events_type_idx
  ON platform.domain_events (tenant_id, event_type, occurred_at DESC);

CREATE INDEX domain_events_correlation_idx
  ON platform.domain_events (tenant_id, correlation_id, occurred_at);

CREATE TABLE platform.domain_event_outbox (
  outbox_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  topic text NOT NULL DEFAULT 'domain.events' CHECK (btrim(topic) <> ''),
  partition_key text NOT NULL CHECK (btrim(partition_key) <> ''),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','CLAIMED','PUBLISHED','FAILED','DEAD')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  claimed_at timestamptz,
  published_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (event_id, tenant_id)
    REFERENCES platform.domain_events(event_id, tenant_id)
    ON DELETE CASCADE,
  UNIQUE (event_id)
);

CREATE INDEX domain_event_outbox_dispatch_idx
  ON platform.domain_event_outbox (status, available_at, created_at)
  WHERE status IN ('PENDING','FAILED');

CREATE INDEX domain_event_outbox_tenant_idx
  ON platform.domain_event_outbox (tenant_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION platform.reject_domain_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'domain events are append-only';
END;
$$;

CREATE TRIGGER domain_events_append_only
BEFORE UPDATE OR DELETE ON platform.domain_events
FOR EACH ROW EXECUTE FUNCTION platform.reject_domain_event_mutation();

ALTER TABLE platform.domain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.domain_events FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.domain_event_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.domain_event_outbox FORCE ROW LEVEL SECURITY;

CREATE POLICY domain_events_tenant_select
  ON platform.domain_events
  FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE POLICY domain_events_tenant_insert
  ON platform.domain_events
  FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY domain_event_outbox_tenant_all
  ON platform.domain_event_outbox
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
