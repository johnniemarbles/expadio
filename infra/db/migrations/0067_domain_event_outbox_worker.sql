BEGIN;

-- Harden the existing Domain Event outbox for safe multi-worker leasing.
-- A claim token prevents a stale worker from acknowledging a row after its
-- lease has expired and another worker has reclaimed it.

ALTER TABLE platform.domain_event_outbox
  ADD COLUMN claim_token uuid,
  ADD COLUMN claim_expires_at timestamptz;

ALTER TABLE platform.domain_event_outbox
  ADD CONSTRAINT domain_event_outbox_claim_state_check CHECK (
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
  );

DROP INDEX IF EXISTS platform.domain_event_outbox_dispatch_idx;

CREATE INDEX domain_event_outbox_dispatch_idx
  ON platform.domain_event_outbox (
    tenant_id,
    status,
    available_at,
    claim_expires_at,
    created_at
  )
  WHERE status IN ('PENDING','FAILED','CLAIMED');

COMMIT;
