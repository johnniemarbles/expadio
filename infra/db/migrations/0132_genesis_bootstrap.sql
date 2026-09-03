BEGIN;

CREATE TABLE platform.genesis_claims (
  claim_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  claimed_by text NOT NULL CHECK (btrim(claimed_by) <> ''),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  bootstrap_state text NOT NULL DEFAULT 'GENESIS_BOOTSTRAPPED'
    CHECK (bootstrap_state IN ('GENESIS_BOOTSTRAPPED','ROOT_ENTITY_CREATED','GOVERNANCE_CONFIGURED','ACTIVE')),
  root_entity_id uuid REFERENCES platform.entity_nodes(node_id),
  bootstrap_completed_at timestamptz,
  idempotency_key uuid,
  step_log jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(step_log) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (bootstrap_state <> 'ACTIVE' OR (root_entity_id IS NOT NULL AND bootstrap_completed_at IS NOT NULL))
);

CREATE UNIQUE INDEX genesis_claims_idempotency_uq
  ON platform.genesis_claims (tenant_id, claimed_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX genesis_claims_active_authority_idx
  ON platform.genesis_claims (tenant_id)
  WHERE root_entity_id IS NULL AND bootstrap_completed_at IS NULL;

-- Claims are service-only: no direct application-role privileges are granted.
REVOKE ALL ON TABLE platform.genesis_claims FROM PUBLIC;

CREATE OR REPLACE FUNCTION platform.bootstrap_tenant_genesis(
  p_tenant_id uuid,
  p_subject_id text,
  p_display_name text,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS TABLE (
  claim_id uuid,
  bootstrap_state text,
  root_entity_id uuid,
  already_existed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
DECLARE
  v_claim platform.genesis_claims%ROWTYPE;
  v_root uuid;
BEGIN
  IF NULLIF(btrim(p_subject_id), '') IS NULL
     OR NULLIF(btrim(p_display_name), '') IS NULL
     OR length(btrim(p_display_name)) > 255 THEN
    RAISE EXCEPTION 'GENESIS_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));

  IF NOT EXISTS (SELECT 1 FROM platform.tenants WHERE tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_claim
    FROM platform.genesis_claims claim
   WHERE claim.tenant_id = p_tenant_id
   FOR UPDATE;

  IF FOUND THEN
    IF v_claim.claimed_by <> p_subject_id THEN
      RAISE EXCEPTION 'GENESIS_CLAIMED' USING ERRCODE = '23505';
    END IF;
    IF p_idempotency_key IS NOT NULL
       AND v_claim.idempotency_key IS DISTINCT FROM p_idempotency_key THEN
      RAISE EXCEPTION 'ALREADY_BOOTSTRAPPED' USING ERRCODE = '23505';
    END IF;
    IF v_claim.root_entity_id IS NOT NULL THEN
      RETURN QUERY SELECT v_claim.claim_id, v_claim.bootstrap_state,
                          v_claim.root_entity_id, true;
      RETURN;
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM platform.entity_nodes
       WHERE tenant_id = p_tenant_id AND status = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'GENESIS_EXPIRED' USING ERRCODE = '23505';
    END IF;

    INSERT INTO platform.genesis_claims (tenant_id, claimed_by, idempotency_key)
    VALUES (p_tenant_id, p_subject_id, p_idempotency_key)
    RETURNING * INTO v_claim;
  END IF;

  INSERT INTO platform.entity_nodes (tenant_id, node_type, display_name, status, created_by)
  VALUES (p_tenant_id, 'BRAND_HQ', btrim(p_display_name), 'ACTIVE', p_subject_id)
  RETURNING node_id INTO v_root;

  UPDATE platform.genesis_claims
     SET root_entity_id = v_root,
         bootstrap_state = 'ROOT_ENTITY_CREATED',
         step_log = step_log || jsonb_build_array(jsonb_build_object(
           'step','ROOT_ENTITY_CREATED','entityId',v_root,'at',clock_timestamp()
         )),
         updated_at = now()
   WHERE platform.genesis_claims.claim_id = v_claim.claim_id;

  RETURN QUERY SELECT v_claim.claim_id, 'ROOT_ENTITY_CREATED'::text, v_root, false;
END;
$$;

REVOKE ALL ON FUNCTION platform.bootstrap_tenant_genesis(uuid, text, text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION platform.touch_genesis_claim()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, platform
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER genesis_claims_touch
BEFORE UPDATE ON platform.genesis_claims
FOR EACH ROW EXECUTE FUNCTION platform.touch_genesis_claim();

COMMIT;
