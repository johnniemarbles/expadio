BEGIN;

-- Migration 0161 created PUBLIC capture sources with allowed_origins derived
-- from lead_publications.brand_domain (the custom domain, e.g. apply.yourbrand.com).
-- That means the subdomain form at {brand_slug}.expadio.com fails the CORS gate
-- because that origin is absent from the allowlist.
--
-- This migration adds 'https://{brand_slug}.expadio.com' to the allowed_origins
-- array for every PUBLIC capture source whose organization has a brand_slug and
-- whose allowlist does not already contain it.

UPDATE platform.lead_capture_sources cs
SET allowed_origins =
      cs.allowed_origins || ARRAY['https://' || o.brand_slug || '.expadio.com']
FROM platform.organizations o
WHERE cs.organization_id = o.organization_id
  AND cs.trust_rail = 'PUBLIC'
  AND o.brand_slug IS NOT NULL
  AND NOT ('https://' || o.brand_slug || '.expadio.com' = ANY(cs.allowed_origins));

COMMIT;
