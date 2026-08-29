BEGIN;

CREATE UNIQUE INDEX industry_pack_versions_one_published_platform_uq
  ON platform.industry_pack_versions (lower(vertical_key))
  WHERE tenant_id IS NULL AND state = 'PUBLISHED';

CREATE UNIQUE INDEX industry_pack_versions_one_published_tenant_uq
  ON platform.industry_pack_versions (tenant_id, lower(vertical_key))
  WHERE tenant_id IS NOT NULL AND state = 'PUBLISHED';

COMMIT;
