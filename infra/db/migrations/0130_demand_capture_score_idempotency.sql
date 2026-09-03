BEGIN;

ALTER TABLE platform.lead_scores
  ADD COLUMN calculation_fingerprint text
  CHECK (calculation_fingerprint IS NULL OR btrim(calculation_fingerprint) <> '');

CREATE UNIQUE INDEX lead_scores_calculation_fingerprint_uq
  ON platform.lead_scores (
    tenant_id,
    organization_id,
    capture_lead_id,
    scoring_profile_id,
    calculation_fingerprint
  )
  WHERE calculation_fingerprint IS NOT NULL;

COMMENT ON COLUMN platform.lead_scores.calculation_fingerprint IS
  'Server-derived fingerprint of scoring profile version plus ordered qualification evidence. Prevents duplicate immutable snapshots on replay; never supplied as client authority.';

COMMIT;
