BEGIN;

-- Two-step backfill for HOSTED_FORM publications whose brand_domain was never
-- stored (created before brand_domain became a required field).
--
-- Step 1: Copy organizations.brand_domain → lead_publications.brand_domain
--   for any HOSTED_FORM publication that has a NULL brand_domain but whose
--   org already has a brand_domain set (e.g. via Brand Settings).
--
-- Step 2: Create the PUBLIC lead_capture_source rows that
--   lookup_public_hosted_forms requires via its inner JOIN, for any HOSTED_FORM
--   publication that now has a brand_domain but still has no capture source.
--   (Migration 0161 missed these because it filtered on p.brand_domain IS NOT NULL.)
--
-- Both steps are idempotent — safe to re-run.

-- Step 1 ─────────────────────────────────────────────────────────────────────
UPDATE platform.lead_publications p
SET    brand_domain = o.brand_domain
FROM   platform.organizations o
WHERE  o.organization_id  = p.organization_id
  AND  p.publication_mode = 'HOSTED_FORM'
  AND  p.brand_domain     IS NULL
  AND  o.brand_domain     IS NOT NULL;

-- Step 2 ─────────────────────────────────────────────────────────────────────
INSERT INTO platform.lead_capture_sources
  (source_id, tenant_id, organization_id, source_key, surface, channel,
   trust_rail, require_signed_ticket, publishable_key, allowed_origins, status)
SELECT
  s.capture_source_id,
  s.tenant_id,
  s.organization_id,
  'pub:' || p.publication_id::text,
  'WEB',
  'WEB',
  'PUBLIC',
  false,
  'cpk_' || encode(gen_random_bytes(30), 'hex'),
  ARRAY['https://' || p.brand_domain]::text[],
  'ACTIVE'
FROM platform.lead_publication_sources s
JOIN platform.lead_publications p
  ON  p.publication_id  = s.publication_id
 AND  p.tenant_id       = s.tenant_id
 AND  p.organization_id = s.organization_id
WHERE p.publication_mode = 'HOSTED_FORM'
  AND p.brand_domain     IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
      FROM platform.lead_capture_sources cs
     WHERE cs.source_id = s.capture_source_id
  );

COMMIT;
