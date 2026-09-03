-- ============================================================================
-- 0123_ownership_interests.sql
-- Entity Graph Phase 4 — normalized JV economics.
--
-- Ownership is modelled separately from relationship edges because:
--   · Multiple concurrent owners (percentages must sum to 100%)
--   · Effective period enforcement (no overlapping ownership by same owner)
--   · Share class / profit class distinction (A-share vs B-share)
--   · Dividend routing metadata (where distributions flow)
--
-- A JV partner owning 30% of a UNIT entity node is an ownership_interest row,
-- not a COMMERCIAL_PARENT edge. The COMMERCIAL_PARENT edge tells you who
-- operates the unit commercially; the ownership_interest tells you who holds
-- economic title.
--
-- Enforcement strategy:
--   A trigger validates the 100% sum constraint and the no-overlap constraint
--   at INSERT/UPDATE time. It does so inside the transaction, not via a
--   deferred constraint, so the failure is immediate and the reason is clear.
-- ============================================================================

BEGIN;

CREATE TABLE platform.ownership_interests (
  interest_id       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,

  -- What is owned.
  owned_node_id     uuid        NOT NULL REFERENCES platform.entity_nodes(node_id),
  -- Who owns it.
  owning_node_id    uuid        NOT NULL REFERENCES platform.entity_nodes(node_id),

  -- Cannot own yourself.
  CONSTRAINT ownership_interests_no_self CHECK (owned_node_id <> owning_node_id),

  -- Percentage: 0 < pct <= 100. Zero ownership is not an interest; it is an absence.
  percentage        numeric(5,2) NOT NULL CHECK (percentage > 0 AND percentage <= 100),

  -- Share / profit class. NULL = undifferentiated / ordinary equity.
  share_class       text,

  -- Effective period. NULL effective_to = currently active.
  effective_from    date        NOT NULL DEFAULT CURRENT_DATE,
  effective_to      date,
  CONSTRAINT ownership_interests_period_check
    CHECK (effective_to IS NULL OR effective_to > effective_from),

  -- Where distributions flow for this interest.
  -- May be the owning node itself, or a nominee/treasury entity.
  distribution_node_id uuid     REFERENCES platform.entity_nodes(node_id),

  -- Partner identifier for external reconciliation (franchisee code, partner ID).
  partner_ref       text,

  -- Legal basis for this interest.
  evidence_ref      text,       -- Agreement ID, share certificate ref, etc.
  agreement_date    date,

  status            text        NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'TRANSFERRED', 'LAPSED', 'DISPUTED')),

  transferred_to_interest_id uuid REFERENCES platform.ownership_interests(interest_id),
  notes             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by        uuid        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ownership_interests_owned_idx
  ON platform.ownership_interests (owned_node_id, status, effective_from);

CREATE INDEX ownership_interests_owning_idx
  ON platform.ownership_interests (owning_node_id, status);

CREATE INDEX ownership_interests_tenant_idx
  ON platform.ownership_interests (tenant_id, status);

ALTER TABLE platform.ownership_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ownership_interests FORCE ROW LEVEL SECURITY;

CREATE POLICY ownership_interests_select
  ON platform.ownership_interests
  FOR SELECT USING (tenant_id = platform.current_tenant_id());

CREATE POLICY ownership_interests_insert
  ON platform.ownership_interests
  FOR INSERT WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY ownership_interests_update
  ON platform.ownership_interests
  FOR UPDATE USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY ownership_interests_no_delete
  ON platform.ownership_interests
  FOR DELETE USING (false);

-- ── Enforcement trigger ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION platform.enforce_ownership_invariants()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  total_active   numeric;
  overlap_count  integer;
BEGIN
  -- Skip enforcement for non-ACTIVE rows: a TRANSFERRED interest is historical.
  IF NEW.status <> 'ACTIVE' THEN
    NEW.updated_at = now();
    RETURN NEW;
  END IF;

  -- 1. No overlapping effective periods for the same owner/owned pair.
  SELECT count(*) INTO overlap_count
  FROM platform.ownership_interests
  WHERE owned_node_id  = NEW.owned_node_id
    AND owning_node_id = NEW.owning_node_id
    AND status = 'ACTIVE'
    AND interest_id <> NEW.interest_id
    AND (
      -- Periods overlap if neither ends before the other starts.
      (NEW.effective_to IS NULL OR NEW.effective_to > effective_from)
      AND
      (effective_to IS NULL OR effective_to > NEW.effective_from)
    );

  IF overlap_count > 0 THEN
    RAISE EXCEPTION
      'Ownership conflict: % already has an active interest in % '
      'that overlaps the period % to %. '
      'Transfer or lapse the existing interest before adding a new one.',
      NEW.owning_node_id, NEW.owned_node_id,
      NEW.effective_from, coalesce(NEW.effective_to::text, 'indefinite');
  END IF;

  -- 2. Total active ownership on this node must not exceed 100%.
  -- We check what the total would be if this row is accepted.
  SELECT coalesce(sum(percentage), 0) INTO total_active
  FROM platform.ownership_interests
  WHERE owned_node_id = NEW.owned_node_id
    AND status = 'ACTIVE'
    AND interest_id <> NEW.interest_id
    AND (effective_to IS NULL OR effective_to > CURRENT_DATE)
    AND effective_from <= CURRENT_DATE;

  IF total_active + NEW.percentage > 100 THEN
    RAISE EXCEPTION
      'Ownership total violation: existing active interests in % sum to %. '
      'Adding % would exceed 100%%. '
      'Reduce an existing interest or set an effective_to before adding more.',
      NEW.owned_node_id, total_active, NEW.percentage;
  END IF;

  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER ownership_interests_enforce
BEFORE INSERT OR UPDATE ON platform.ownership_interests
FOR EACH ROW EXECUTE FUNCTION platform.enforce_ownership_invariants();

-- ── Convenience view: current ownership snapshot ───────────────────────────
-- Shows only currently active interests (effective today, not terminated).
CREATE OR REPLACE VIEW platform.current_ownership AS
  SELECT
    i.interest_id,
    i.tenant_id,
    i.owned_node_id,
    owned.display_name  AS owned_name,
    owned.node_type     AS owned_type,
    i.owning_node_id,
    owning.display_name AS owning_name,
    owning.node_type    AS owning_type,
    i.percentage,
    i.share_class,
    i.effective_from,
    i.distribution_node_id,
    i.partner_ref,
    i.evidence_ref
  FROM platform.ownership_interests i
  JOIN platform.entity_nodes owned  ON owned.node_id  = i.owned_node_id
  JOIN platform.entity_nodes owning ON owning.node_id = i.owning_node_id
  WHERE i.status = 'ACTIVE'
    AND i.effective_from <= CURRENT_DATE
    AND (i.effective_to IS NULL OR i.effective_to > CURRENT_DATE);

COMMIT;
