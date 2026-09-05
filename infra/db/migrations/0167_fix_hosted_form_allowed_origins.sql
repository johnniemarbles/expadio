BEGIN;

-- Ensure every HOSTED_FORM publication's capture source has the publication's
-- brand_domain origin in its allowed_origins list.
-- Idempotent: only appends when the origin is absent.
-- Covers cases where the capture source was created before the brand_domain was
-- set on the publication, so allowed_origins never included the custom domain.

UPDATE platform.lead_capture_sources cs
SET    allowed_origins = array_append(cs.allowed_origins, 'https://' || p.brand_domain)
FROM   platform.lead_publication_sources s
JOIN   platform.lead_publications p
       ON  p.publication_id    = s.publication_id
      AND  p.tenant_id         = s.tenant_id
      AND  p.organization_id   = s.organization_id
WHERE  cs.source_id            = s.capture_source_id
  AND  p.publication_mode      = 'HOSTED_FORM'
  AND  p.brand_domain          IS NOT NULL
  AND  NOT ('https://' || p.brand_domain = ANY(cs.allowed_origins));

COMMIT;
