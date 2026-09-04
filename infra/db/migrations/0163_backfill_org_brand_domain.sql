BEGIN;

-- Backfill organizations.brand_domain from hosted-form publication domains
-- for organisations that have a HOSTED_FORM publication but no brand_domain set yet.
--
-- The enquire page resolves the org by organizations.brand_domain (via
-- lookup_org_by_brand_domain), which is distinct from lead_publications.brand_domain.
-- Publications created before Brand Settings was wired up left organizations.brand_domain
-- as NULL, causing lookup_org_by_brand_domain to return nothing and the form to 404.
--
-- Only applies when all HOSTED_FORM publications for an org share the same domain
-- (to avoid ambiguity). Safe to re-run — skips any org that already has a brand_domain.

UPDATE platform.organizations o
SET brand_domain = sub.brand_domain
FROM (
  SELECT organization_id,
         MIN(brand_domain) AS brand_domain
    FROM platform.lead_publications
   WHERE publication_mode = 'HOSTED_FORM'
     AND brand_domain IS NOT NULL
   GROUP BY organization_id
  HAVING COUNT(DISTINCT brand_domain) = 1
) sub
WHERE o.organization_id = sub.organization_id
  AND o.brand_domain IS NULL;

COMMIT;
