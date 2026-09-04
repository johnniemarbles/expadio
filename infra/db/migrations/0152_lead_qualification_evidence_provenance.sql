BEGIN;

-- ADR-017 Invariant 3 — qualification facts carry immutable evidence_source provenance.
--
-- Every row in lead_qualifications must declare how the criterion response was
-- determined. The application layer (qualification-provenance.ts) enforces this
-- at the TypeScript boundary; this constraint enforces it at the database boundary.
--
-- Backfill: existing rows are assigned OPERATOR_ASSESSED (the most conservative
-- assumption for historical assessments where the source was not recorded).
-- The default is then dropped so that all new inserts must supply the column.

ALTER TABLE platform.lead_qualifications
  ADD COLUMN evidence_source text NOT NULL DEFAULT 'OPERATOR_ASSESSED'
  CHECK (evidence_source IN (
    'SELF_DECLARED',
    'SYSTEM_DERIVED',
    'OPERATOR_ASSESSED',
    'DOCUMENT_VERIFIED',
    'EXTERNAL_VERIFIED'
  ));

ALTER TABLE platform.lead_qualifications
  ALTER COLUMN evidence_source DROP DEFAULT;

COMMENT ON COLUMN platform.lead_qualifications.evidence_source IS
  'ADR-017 Invariant 3: how the criterion response was determined. SELF_DECLARED = lead self-report; SYSTEM_DERIVED = computed from behavioral signals; OPERATOR_ASSESSED = human operator review; DOCUMENT_VERIFIED = verified against submitted documents; EXTERNAL_VERIFIED = verified via third-party source. NOT NULL — no write path may omit this.';

COMMIT;
