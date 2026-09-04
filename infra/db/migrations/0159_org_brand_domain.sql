BEGIN;

-- Brand identity + custom domain per organisation
ALTER TABLE platform.organizations
  ADD COLUMN IF NOT EXISTS brand_slug         text,
  ADD COLUMN IF NOT EXISTS brand_display_name text,
  ADD COLUMN IF NOT EXISTS brand_domain       text,
  ADD COLUMN IF NOT EXISTS brand_domain_verified_at  timestamptz,
  ADD COLUMN IF NOT EXISTS brand_domain_verify_token text;

-- slug: lowercase alphanumeric + hyphens, 3-50 chars, not starting/ending with hyphen
ALTER TABLE platform.organizations
  ADD CONSTRAINT organizations_brand_slug_format
    CHECK (
      brand_slug IS NULL
      OR brand_slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'
    );

-- domain: must not carry a scheme prefix
ALTER TABLE platform.organizations
  ADD CONSTRAINT organizations_brand_domain_no_scheme
    CHECK (
      brand_domain IS NULL
      OR brand_domain !~ '^https?://'
    );

-- One slug per slug value across the whole platform
CREATE UNIQUE INDEX IF NOT EXISTS organizations_brand_slug_uniq
  ON platform.organizations (brand_slug)
  WHERE brand_slug IS NOT NULL;

-- One domain per domain value across the whole platform
CREATE UNIQUE INDEX IF NOT EXISTS organizations_brand_domain_uniq
  ON platform.organizations (brand_domain)
  WHERE brand_domain IS NOT NULL;

COMMIT;
