-- ============================================================================
-- 0125_genesis_bootstrap.sql
-- Entity Graph Phase 6 — genesis onboarding, solving the first-user deadlock.
--
-- The deadlock: resolveBrandContext() requires an active membership before
-- brand onboarding can run. But a brand-new tenant has no membership yet,
-- so the first user cannot complete onboarding.
--
-- The fix: a one-time, tenant-scoped genesis claim that grants a temporary
-- bootstrap authority to the first verified subject, valid only while the
-- tenant has zero entities and zero established governance.
--
-- Genesis authority is:
--   · transactional and server-side — never a client flag or a feature toggle
--   · one-time — a unique constraint on (tenant_id) prevents a second claim
--   · self-terminating — expires automatically when root_entity_id is set
--   · auditable — the claim record persists even after completion
--
-- The claim does NOT grant any authority after bootstrap_completed_at is set.
-- A POST to the bootstrap endpoint on an already-bootstrapped tenant returns
-- 409 ALREADY_BOOTSTRAPPED, not a successful response.
-- ============================================================================

BEGIN;

-- ── Genesis claim ───────────────────────────────────────────────────────────

CREATE TABLE platform.genesis_claims (
  claim_id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- One claim per tenant. The unique constraint is the entire security guarantee:
  -- only one subject can win the race to claim genesis authority.
  tenant_id             uuid        NOT NULL UNIQUE
                        REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,

  -- The verified subject who claimed genesis.
  claimed_by            uuid        NOT NULL,
  claimed_at            timestamptz NOT NULL DEFAULT now(),

  -- Bootstrap state machine.
  -- GENESIS_BOOTSTRAPPED → ROOT_ENTITY_CREATED → GOVERNANCE_CONFIGURED → ACTIVE
  bootstrap_state       text        NOT NULL DEFAULT 'GENESIS_BOOTSTRAPPED'
                        CHECK (bootstrap_state IN (
                          'GENESIS_BOOTSTRAPPED',  -- claim won; membership not yet created
                          'ROOT_ENTITY_CREATED',   -- BRAND_HQ entity node created
                          'GOVERNANCE_CONFIGURED', -- enterprise profile created
                          'ACTIVE'                 -- tenant is fully bootstrapped
                        )),

  -- Set when the root BRAND_HQ entity node is created.
  -- Genesis authority expires as soon as this is non-NULL.
  root_entity_id        uuid        REFERENCES platform.entity_nodes(node_id),

  -- Set when the full bootstrap sequence completes.
  bootstrap_completed_at timestamptz,

  -- Idempotency: if the request is retried, return the same result.
  -- Stored as a hash of the initial request parameters.
  idempotency_key       text        UNIQUE,

  -- Audit trail of each bootstrap step.
  step_log              jsonb       NOT NULL DEFAULT '[]'::jsonb,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- Completed claims must have a root entity and a completed timestamp.
  CHECK (
    (bootstrap_state = 'ACTIVE'
      AND root_entity_id IS NOT NULL
      AND bootstrap_completed_at IS NOT NULL)
    OR bootstrap_state <> 'ACTIVE'
  )
);

-- Genesis authority is valid only while root_entity_id IS NULL.
-- This index is used by the authorization check in the bootstrap route.
CREATE INDEX genesis_claims_active_authority_idx
  ON platform.genesis_claims (tenant_id)
  WHERE root_entity_id IS NULL AND bootstrap_completed_at IS NULL;

-- ── No RLS on genesis_claims — it is a platform-level table ────────────────
-- The bootstrap route reads this table as a service account, not as a tenant.
-- A tenant-scoped GUC would prevent the bootstrap from running before the
-- tenant context exists, which is exactly the deadlock we are solving.
-- The bootstrap function validates tenant ownership using the Clerk subject
-- directly, not through RLS.

-- ── Bootstrap transaction function ─────────────────────────────────────────
-- Called by the /api/bootstrap/genesis route.
-- Performs the entire bootstrap atomically:
--   1. Verify the claim is unclaimed or belongs to this subject (idempotent)
--   2. Insert the genesis claim (wins the race or returns existing)
--   3. Create membership as TENANT_OWNER
--   4. Create the BRAND_HQ entity node
--   5. Advance bootstrap_state to ROOT_ENTITY_CREATED
--   6. Return the claim record
--
-- The enterprise profile creation (GOVERNANCE_CONFIGURED) is a separate step
-- because it requires user input. The genesis function creates the structural
-- minimum; the profile is filled in during onboarding.

CREATE OR REPLACE FUNCTION platform.bootstrap_tenant_genesis(
  p_tenant_id          uuid,
  p_subject_id         uuid,
  p_display_name       text,
  p_idempotency_key    text DEFAULT NULL
)
RETURNS TABLE (
  claim_id             uuid,
  bootstrap_state      text,
  root_entity_id       uuid,
  already_existed      boolean
)
LANGUAGE plpgsql AS $$
DECLARE
  v_claim              platform.genesis_claims%ROWTYPE;
  v_root_entity_id     uuid;
  v_already_existed    boolean := false;
  v_tenant_exists      boolean;
BEGIN
  -- Verify the tenant exists.
  SELECT EXISTS (
    SELECT 1 FROM platform.tenants WHERE tenant_id = p_tenant_id
  ) INTO v_tenant_exists;

  IF NOT v_tenant_exists THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND: tenant % does not exist', p_tenant_id;
  END IF;

  -- Verify no active entities exist yet (genesis is only valid at zero-entity state).
  IF EXISTS (
    SELECT 1 FROM platform.entity_nodes
    WHERE tenant_id = p_tenant_id AND status = 'ACTIVE'
    LIMIT 1
  ) THEN
    RAISE EXCEPTION
      'GENESIS_EXPIRED: this tenant already has active entities. '
      'Genesis bootstrap is a one-time operation at tenant creation.';
  END IF;

  -- Attempt to win the genesis claim (or retrieve the existing one).
  INSERT INTO platform.genesis_claims (
    tenant_id, claimed_by, bootstrap_state, idempotency_key
  )
  VALUES (
    p_tenant_id, p_subject_id, 'GENESIS_BOOTSTRAPPED', p_idempotency_key
  )
  ON CONFLICT (tenant_id) DO UPDATE
    -- Only update if the same subject is retrying.
    SET updated_at = now()
    WHERE platform.genesis_claims.claimed_by = p_subject_id
      AND platform.genesis_claims.bootstrap_completed_at IS NULL
  RETURNING * INTO v_claim;

  -- If ON CONFLICT did not UPDATE (different subject or already completed),
  -- the row exists but is not owned by this subject.
  IF v_claim.claim_id IS NULL THEN
    SELECT * INTO v_claim FROM platform.genesis_claims WHERE tenant_id = p_tenant_id;
    IF v_claim.claimed_by <> p_subject_id THEN
      RAISE EXCEPTION
        'GENESIS_CLAIMED: another subject has already claimed genesis for this tenant.';
    END IF;
    IF v_claim.bootstrap_completed_at IS NOT NULL THEN
      RAISE EXCEPTION
        'ALREADY_BOOTSTRAPPED: this tenant has already completed genesis bootstrap.';
    END IF;
    v_already_existed := true;
  END IF;

  -- If root entity already exists (idempotent retry), return as-is.
  IF v_claim.root_entity_id IS NOT NULL THEN
    RETURN QUERY SELECT
      v_claim.claim_id, v_claim.bootstrap_state, v_claim.root_entity_id, true;
    RETURN;
  END IF;

  -- Create the BRAND_HQ entity node.
  INSERT INTO platform.entity_nodes (
    tenant_id, node_type, display_name, status, created_by
  )
  VALUES (
    p_tenant_id, 'BRAND_HQ', p_display_name, 'ACTIVE', p_subject_id
  )
  RETURNING node_id INTO v_root_entity_id;

  -- Create tenant owner membership.
  -- This is what unblocks resolveBrandContext() for all subsequent requests.
  INSERT INTO platform.memberships (
    tenant_id, subject_id, role, status, granted_by, granted_at
  )
  VALUES (
    p_tenant_id, p_subject_id, 'TENANT_OWNER', 'ACTIVE', p_subject_id, now()
  )
  ON CONFLICT (tenant_id, subject_id) DO UPDATE
    SET role = 'TENANT_OWNER', status = 'ACTIVE', updated_at = now();

  -- Advance the claim: root entity created, genesis authority now expires.
  UPDATE platform.genesis_claims
  SET root_entity_id   = v_root_entity_id,
      bootstrap_state  = 'ROOT_ENTITY_CREATED',
      step_log         = step_log || jsonb_build_object(
        'step', 'ROOT_ENTITY_CREATED',
        'entity_id', v_root_entity_id,
        'at', now()
      ),
      updated_at       = now()
  WHERE claim_id = v_claim.claim_id;

  RETURN QUERY SELECT
    v_claim.claim_id,
    'ROOT_ENTITY_CREATED'::text,
    v_root_entity_id,
    v_already_existed;
END;
$$;

COMMENT ON FUNCTION platform.bootstrap_tenant_genesis(uuid, uuid, text, text) IS
  'One-time atomic genesis bootstrap. Creates the BRAND_HQ entity node, '
  'TENANT_OWNER membership, and genesis claim record in a single transaction. '
  'Idempotent: a retry by the same subject returns the existing result. '
  'Rejects if: tenant has active entities, a different subject already claimed, '
  'or bootstrap is already complete.';

-- ── updated_at maintenance ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION platform.touch_genesis_claim()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER genesis_claims_touch
BEFORE UPDATE ON platform.genesis_claims
FOR EACH ROW EXECUTE FUNCTION platform.touch_genesis_claim();

COMMIT;
