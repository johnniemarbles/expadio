BEGIN;

-- Backfill PUBLIC lead_capture_sources for HOSTED_FORM publications that were
-- created before the POST /api/leads/publications handler started creating them
-- automatically.  The inner join in lookup_public_hosted_forms requires this
-- row to exist; without it every pre-existing hosted-form URL returns 404.
--
-- Uses encode(gen_random_bytes(30), 'hex') for the publishable key body —
-- 60 hex chars gives equivalent entropy to the TypeScript implementation.

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
  ON p.publication_id  = s.publication_id
 AND p.tenant_id       = s.tenant_id
 AND p.organization_id = s.organization_id
WHERE p.publication_mode = 'HOSTED_FORM'
  AND p.brand_domain IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
      FROM platform.lead_capture_sources cs
     WHERE cs.source_id = s.capture_source_id
  );

COMMIT;
