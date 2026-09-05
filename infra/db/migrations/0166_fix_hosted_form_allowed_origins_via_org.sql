BEGIN;

-- Migration 0165 sourced brand_domain from lead_publications, which may still
-- be NULL if the publication predates the brand_domain column being populated.
-- This migration sources the domain directly from organizations.brand_domain,
-- which is authoritative (set via Brand Settings UI).
-- Idempotent: only appends when the origin is absent.

UPDATE platform.lead_capture_sources cs
SET    allowed_origins = array_append(cs.allowed_origins, 'https://' || o.brand_domain)
FROM   platform.lead_publication_sources ps
JOIN   platform.lead_publications p
       ON  p.publication_id  = ps.publication_id
      AND  p.tenant_id       = ps.tenant_id
      AND  p.organization_id = ps.organization_id
JOIN   platform.organizations o
       ON  o.organization_id = p.organization_id
      AND  o.tenant_id       = p.tenant_id
WHERE  cs.source_id          = ps.capture_source_id
  AND  p.publication_mode    = 'HOSTED_FORM'
  AND  o.brand_domain        IS NOT NULL
  AND  NOT ('https://' || o.brand_domain = ANY(cs.allowed_origins));

COMMIT;
