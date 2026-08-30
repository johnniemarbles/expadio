BEGIN;

-- Domain Event Consumer Inbox
--
-- Transport publication and business-consumer processing are separate concerns.
-- One Domain Event can be received by multiple named consumers. Each consumer
-- owns its own idempotent delivery/lease/retry state.

CREATE TABLE platform.domain_event_inbox (
  inbox_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  consumer_key text NOT NULL CHECK (btrim(consumer_key) <> ''),
  event_id uuid NOT NULL,
  topic text NOT NULL CHECK (btrim(topic) <> ''),
  partition_key text NOT NULL CHECK (btrim(partition_key) <> ''),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','CLAIMED','PROCESSED','FAILED','DEAD')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  claimed_at timestamptz,
  claim_token uuid,
  claim_expires_at timestamptz,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (event_id, tenant_id)
    REFERENCES platform.domain_events(event_id, tenant_id)
    ON DELETE CASCADE,
  UNIQUE (tenant_id, consumer_key, event_id),
  CHECK (
    (
      status = 'CLAIMED'
      AND claimed_at IS NOT NULL
      AND claim_token IS NOT NULL
      AND claim_expires_at IS NOT NULL
      AND claim_expires_at > claimed_at
    )
    OR
    (
      status <> 'CLAIMED'
      AND claim_token IS NULL
      AND claim_expires_at IS NULL
    )
  ),
  CHECK (
    (status = 'PROCESSED' AND processed_at IS NOT NULL)
    OR
    (status <> 'PROCESSED' AND processed_at IS NULL)
  )
);

CREATE INDEX domain_event_inbox_dispatch_idx
  ON platform.domain_event_inbox (
    tenant_id,
    consumer_key,
    status,
    available_at,
    claim_expires_at,
    received_at,
    inbox_id
  )
  WHERE status IN ('PENDING','FAILED','CLAIMED');

CREATE INDEX domain_event_inbox_event_idx
  ON platform.domain_event_inbox (
    tenant_id,
    event_id,
    consumer_key
  );

ALTER TABLE platform.domain_event_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.domain_event_inbox FORCE ROW LEVEL SECURITY;

CREATE POLICY domain_event_inbox_tenant_all
  ON platform.domain_event_inbox
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
