BEGIN;

-- Demand-capture convert seam (freeze exception 2026-08-31).
-- Provenance only. Does not create a second CRM and does not copy extract tables.
-- Capture history stays in the extract until a later merge after live RLS soak.

ALTER TABLE platform.crm_leads
  ADD COLUMN IF NOT EXISTS capture_lead_id uuid,
  ADD COLUMN IF NOT EXISTS capture_layer_id text;

CREATE UNIQUE INDEX IF NOT EXISTS crm_leads_tenant_capture_uidx
  ON platform.crm_leads (tenant_id, capture_lead_id)
  WHERE capture_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS crm_leads_tenant_capture_layer_idx
  ON platform.crm_leads (tenant_id, capture_layer_id)
  WHERE capture_layer_id IS NOT NULL;

COMMENT ON COLUMN platform.crm_leads.capture_lead_id IS
  'Extract capture lead id. Convert is idempotent on (tenant_id, capture_lead_id). Capture row is not deleted.';
COMMENT ON COLUMN platform.crm_leads.capture_layer_id IS
  'Brand-layer path id from the extract source registry. Visibility remains tenant RLS + app grants.';

-- Soak catalogue. Run against a live cluster with two tenants after extract 0001+0002.
CREATE OR REPLACE FUNCTION platform.lead_capture_soak_expectations()
RETURNS TABLE (check_name text, expected text) LANGUAGE sql AS $$
  SELECT * FROM (VALUES
    ('tenant_a_cannot_read_tenant_b_crm_leads', '0 rows'),
    ('sibling_brand_leads_are_distinct_rows', '2 rows same email'),
    ('country_grant_cannot_read_sibling_country', '0 rows'),
    ('hq_grant_reads_descendant_capture_layer', '>0 rows'),
    ('convert_is_idempotent_on_capture_lead_id', '1 crm row'),
    ('convert_does_not_delete_capture_lead', 'capture row still present')
  ) AS t(check_name, expected);
$$;

COMMIT;
