BEGIN;

-- Public-form org lookup for the hosted enquiry form pages.
--
-- The brand-web enquiry form pages are served to unauthenticated browsers at
-- {slug}.expadio.com/enquire or a custom domain like apply.yourbrand.com/enquire.
-- The server component has no auth token, so it cannot call resolveBrandContext().
-- These SECURITY DEFINER functions bypass RLS to find the org by its public
-- identifier (brand_slug or brand_domain) and return only the fields the form
-- page needs: routing coordinates and display names.
--
-- They expose NO business data (no leads, no pipeline, no config).

CREATE OR REPLACE FUNCTION platform.lookup_org_by_brand_slug(
  p_slug text
)
RETURNS TABLE (
  tenant_id   uuid,
  organization_id uuid,
  org_name    text,
  brand_display_name text,
  brand_slug  text,
  brand_domain text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = platform, pg_temp
AS $$
  SELECT o.tenant_id,
         o.organization_id,
         o.organization_name,
         o.brand_display_name,
         o.brand_slug,
         o.brand_domain
    FROM platform.organizations o
   WHERE o.brand_slug = lower(btrim(p_slug))
     AND o.brand_slug IS NOT NULL
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION platform.lookup_org_by_brand_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.lookup_org_by_brand_slug(text) TO PUBLIC;

CREATE OR REPLACE FUNCTION platform.lookup_org_by_brand_domain(
  p_domain text
)
RETURNS TABLE (
  tenant_id   uuid,
  organization_id uuid,
  org_name    text,
  brand_display_name text,
  brand_slug  text,
  brand_domain text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = platform, pg_temp
AS $$
  SELECT o.tenant_id,
         o.organization_id,
         o.organization_name,
         o.brand_display_name,
         o.brand_slug,
         o.brand_domain
    FROM platform.organizations o
   WHERE lower(btrim(o.brand_domain)) = lower(btrim(p_domain))
     AND o.brand_domain IS NOT NULL
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION platform.lookup_org_by_brand_domain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.lookup_org_by_brand_domain(text) TO PUBLIC;

-- Lookup active HOSTED_FORM publications for a public form page.
-- Returns publication routing + the capture source coordinates needed to
-- initialise createBrowserCaptureClient in the browser.
CREATE OR REPLACE FUNCTION platform.lookup_public_hosted_forms(
  p_tenant_id uuid,
  p_organization_id uuid
)
RETURNS TABLE (
  publication_id    uuid,
  capture_config_id uuid,
  interest_type     text,
  opportunity_type  text,
  publication_slug  text,
  brand_domain      text,
  capture_source_id uuid,
  publishable_key   text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = platform, pg_temp
AS $$
  SELECT p.publication_id,
         p.capture_config_id,
         p.interest_type,
         p.opportunity_type,
         p.publication_slug,
         p.brand_domain,
         s.source_id   AS capture_source_id,
         cs.publishable_key
    FROM platform.lead_publications p
    JOIN platform.lead_publication_sources s
      ON s.publication_id   = p.publication_id
     AND s.tenant_id        = p.tenant_id
     AND s.organization_id  = p.organization_id
    JOIN platform.lead_capture_sources cs
      ON cs.source_id       = s.capture_source_id
     AND cs.tenant_id       = p.tenant_id
     AND cs.trust_rail      = 'PUBLIC'
     AND cs.status          = 'ACTIVE'
   WHERE p.tenant_id        = p_tenant_id
     AND p.organization_id  = p_organization_id
     AND p.status           IN ('PUBLISHED', 'DRAFT')
     AND p.publication_mode = 'HOSTED_FORM'
   ORDER BY p.created_at ASC;
$$;

REVOKE ALL ON FUNCTION platform.lookup_public_hosted_forms(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.lookup_public_hosted_forms(uuid, uuid) TO PUBLIC;

COMMIT;
