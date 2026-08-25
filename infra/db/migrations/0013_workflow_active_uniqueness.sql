BEGIN;

CREATE UNIQUE INDEX workflow_blueprints_platform_active_work_type_uq
  ON platform.workflow_blueprints (work_type_key)
  WHERE tenant_id IS NULL AND state = 'ACTIVE';

CREATE UNIQUE INDEX workflow_blueprints_tenant_active_work_type_uq
  ON platform.workflow_blueprints (tenant_id, work_type_key)
  WHERE tenant_id IS NOT NULL AND state = 'ACTIVE';

COMMIT;
