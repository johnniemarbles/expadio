-- ============================================================================
-- 0121_entity_relationships_governed.sql
-- Entity Graph Phase 2 — governed relationship taxonomy.
--
-- Migration 0063 created platform.entity_relationships with a free-form
-- relationship_key. This migration evolves that table:
--   · adds the six governed relationship types via CHECK constraint
--   · adds required metadata columns (effective dates, evidence, approver)
--   · adds cardinality enforcement via trigger
--   · migrates existing free-form rows to LEGACY status for manual review
--
-- The table is evolved in-place rather than replaced so that existing
-- application queries continue to compile while the migration runs.
-- The LEGACY relationship_type acts as a marker: any row classified LEGACY
-- must be reviewed and reclassified before the entity graph can be the
-- authoritative source for that relationship.
-- ============================================================================

BEGIN;

-- ── Step 1: add the new columns before adding the constraint ───────────────

-- The governed relationship types, plus LEGACY for existing free-form rows.
ALTER TABLE platform.entity_relationships
  ADD COLUMN IF NOT EXISTS relationship_type text,
  ADD COLUMN IF NOT EXISTS effective_from    date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS effective_to      date,
  ADD COLUMN IF NOT EXISTS evidence_ref      text,
  ADD COLUMN IF NOT EXISTS approved_by       text,
  ADD COLUMN IF NOT EXISTS notes             jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── Step 2: migrate existing free-form rows to LEGACY ─────────────────────
-- LEGACY rows are preserved, queryable, and auditable. They are not deleted.
-- They are excluded from cardinality enforcement (so this migration does not
-- break existing data). They require manual classification before use.
UPDATE platform.entity_relationships
SET relationship_type = 'LEGACY'
WHERE relationship_type IS NULL;

-- Now the column can be made NOT NULL with the constraint.
ALTER TABLE platform.entity_relationships
  ALTER COLUMN relationship_type SET NOT NULL;

ALTER TABLE platform.entity_relationships
  ADD CONSTRAINT entity_relationships_type_check
  CHECK (relationship_type IN (
    -- The six governed types. Each has defined cardinality semantics.
    'COMMERCIAL_PARENT',       -- royalty/commercial chain: one active per node
    'OPERATIONAL_PARENT',      -- operational reporting: one active per node
    'TERRITORIAL_JURISDICTION',-- territory rights over this node: one active per UNIT
    'GOVERNANCE_PARENT',       -- compliance/standards authority: one active per node
    'LOCATED_IN',              -- physical geography: one active per geography level
    'OWNERSHIP',               -- economic ownership (use ownership_interests for % splits)
    -- Non-governed legacy; these rows need manual reclassification.
    'LEGACY'
  ));

-- Effective period sanity: to must be after from when set.
ALTER TABLE platform.entity_relationships
  ADD CONSTRAINT entity_relationships_effective_period_check
  CHECK (effective_to IS NULL OR effective_to > effective_from);

-- Expand the legacy status constraint for governed history.
ALTER TABLE platform.entity_relationships
  DROP CONSTRAINT IF EXISTS entity_relationships_status_check;
ALTER TABLE platform.entity_relationships
  ADD CONSTRAINT entity_relationships_status_check
  CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUPERSEDED', 'TERMINATED'));

-- ── Step 3: add source and target node references ──────────────────────────
-- 0063 may have used generic uuid columns or organization references.
-- We add explicit entity_node references that coexist with whatever 0063 had.
ALTER TABLE platform.entity_relationships
  ADD COLUMN IF NOT EXISTS source_node_id uuid REFERENCES platform.entity_nodes(node_id),
  ADD COLUMN IF NOT EXISTS target_node_id uuid REFERENCES platform.entity_nodes(node_id);

ALTER TABLE platform.entity_relationships
  ADD CONSTRAINT entity_relationships_source_node_tenant_fk
    FOREIGN KEY (source_node_id, tenant_id)
    REFERENCES platform.entity_nodes(node_id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT entity_relationships_target_node_tenant_fk
    FOREIGN KEY (target_node_id, tenant_id)
    REFERENCES platform.entity_nodes(node_id, tenant_id) ON DELETE RESTRICT;

-- Self-relationships are not meaningful in this model.
ALTER TABLE platform.entity_relationships
  ADD CONSTRAINT entity_relationships_no_self_loop
  CHECK (source_node_id IS DISTINCT FROM target_node_id OR source_node_id IS NULL);

-- ── Step 4: indexes for cardinality enforcement queries ────────────────────

-- Active governed relationships by target node — used by the cardinality trigger.
CREATE INDEX entity_relationships_active_governed_idx
  ON platform.entity_relationships (target_node_id, relationship_type, effective_from)
  WHERE effective_to IS NULL
    AND relationship_type NOT IN ('LEGACY', 'OWNERSHIP')
    AND source_node_id IS NOT NULL;

-- Timeline lookup — for "what was the commercial parent of X on date Y?"
CREATE INDEX entity_relationships_timeline_idx
  ON platform.entity_relationships (target_node_id, relationship_type, effective_from, effective_to)
  WHERE source_node_id IS NOT NULL;

-- ── Step 5: cardinality enforcement trigger ────────────────────────────────
-- Enforces: at most one active edge of a singleton type per target node.
-- Singleton types: COMMERCIAL_PARENT, OPERATIONAL_PARENT, TERRITORIAL_JURISDICTION,
--                  GOVERNANCE_PARENT.
-- LOCATED_IN cardinality is checked separately (per geography level, not globally).
-- OWNERSHIP and LEGACY are not singleton-enforced here.

CREATE OR REPLACE FUNCTION platform.enforce_relationship_cardinality()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  singleton_types text[] := ARRAY[
    'COMMERCIAL_PARENT',
    'OPERATIONAL_PARENT',
    'TERRITORIAL_JURISDICTION',
    'GOVERNANCE_PARENT'
  ];
  conflict_count integer;
BEGIN
  -- Only enforce for governed singleton types with a real node reference.
  IF NEW.relationship_type = ANY(singleton_types)
    AND NEW.target_node_id IS NOT NULL
    AND NEW.effective_to IS NULL
  THEN
    SELECT count(*) INTO conflict_count
    FROM platform.entity_relationships
    WHERE target_node_id    = NEW.target_node_id
      AND relationship_type = NEW.relationship_type
      AND effective_to      IS NULL
      AND source_node_id    IS NOT NULL
      AND (TG_OP = 'INSERT' OR relationship_id <> NEW.relationship_id);

    IF conflict_count > 0 THEN
      RAISE EXCEPTION
        'Cardinality violation: % already has an active % edge. '
        'Terminate the existing edge (set effective_to) before adding a new one. '
        'target_node_id=%, relationship_type=%',
        NEW.target_node_id, NEW.relationship_type,
        NEW.target_node_id, NEW.relationship_type;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER entity_relationships_cardinality_check
BEFORE INSERT OR UPDATE ON platform.entity_relationships
FOR EACH ROW EXECUTE FUNCTION platform.enforce_relationship_cardinality();

-- ── Step 6: helper function — active edges for a node ─────────────────────
CREATE OR REPLACE FUNCTION platform.active_edges(
  p_node_id         uuid,
  p_relationship    text DEFAULT NULL,
  p_as_source       boolean DEFAULT true
)
RETURNS TABLE (
  relationship_id   uuid,
  relationship_type text,
  source_node_id    uuid,
  target_node_id    uuid,
  effective_from    date,
  evidence_ref      text,
  notes             jsonb
)
LANGUAGE sql STABLE AS $$
  SELECT
    relationship_id,
    relationship_type,
    source_node_id,
    target_node_id,
    effective_from,
    evidence_ref,
    notes
  FROM platform.entity_relationships
  WHERE
    ((p_as_source AND source_node_id = p_node_id)
      OR (NOT p_as_source AND target_node_id = p_node_id))
    AND effective_to IS NULL
    AND status = 'ACTIVE'
    AND (p_relationship IS NULL OR relationship_type = p_relationship)
  ORDER BY effective_from DESC;
$$;

COMMIT;
