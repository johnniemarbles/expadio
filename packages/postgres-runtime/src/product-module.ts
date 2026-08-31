import { randomUUID } from 'node:crypto';
import {
  assertTenantModuleActivationAllowed,
  isTenantModuleOperational,
  resolveTenantModuleAvailability,
  type TenantModuleAvailability,
  type TenantModuleState,
} from '@expadio/capabilities';
import type { PostgresClient } from './index.ts';
import { appendDomainEventWithOutbox } from './domain-events.ts';

interface ModuleCatalogRow {
  readonly module_key: string;
  readonly display_name: string;
  readonly description: string;
  readonly manifest: Record<string, unknown>;
  readonly enabled: boolean;
  readonly installation_state: TenantModuleState | null;
  readonly entitlement_active: boolean;
  readonly entitlement_source_type: string | null;
  readonly entitlement_source_key: string | null;
}

export interface TenantProductModuleSummary {
  readonly moduleKey: string;
  readonly displayName: string;
  readonly description: string;
  readonly manifest: Record<string, unknown>;
  readonly availability: TenantModuleAvailability;
  readonly installationState: TenantModuleState | null;
  readonly entitlement: {
    readonly active: boolean;
    readonly sourceType: string | null;
    readonly sourceKey: string | null;
  };
}

const ACTIVE_ENTITLEMENT_SQL =
  "e.status = 'ACTIVE' AND e.valid_from <= now() AND (e.valid_until IS NULL OR e.valid_until > now())";

export async function listTenantProductModules(
  client: PostgresClient,
  tenantId: string,
): Promise<readonly TenantProductModuleSummary[]> {
  const sql =
    'SELECT m.module_key, m.display_name, m.description, m.manifest, m.enabled, ' +
    'tm.status AS installation_state, ' +
    'EXISTS (SELECT 1 FROM platform.tenant_module_entitlements e ' +
    'WHERE e.tenant_id = $1::uuid AND e.module_key = m.module_key AND ' + ACTIVE_ENTITLEMENT_SQL + ') AS entitlement_active, ' +
    '(SELECT e.source_type FROM platform.tenant_module_entitlements e ' +
    'WHERE e.tenant_id = $1::uuid AND e.module_key = m.module_key AND ' + ACTIVE_ENTITLEMENT_SQL +
    ' ORDER BY e.valid_from DESC LIMIT 1) AS entitlement_source_type, ' +
    '(SELECT e.source_key FROM platform.tenant_module_entitlements e ' +
    'WHERE e.tenant_id = $1::uuid AND e.module_key = m.module_key AND ' + ACTIVE_ENTITLEMENT_SQL +
    ' ORDER BY e.valid_from DESC LIMIT 1) AS entitlement_source_key ' +
    'FROM platform.product_modules m ' +
    'LEFT JOIN platform.tenant_modules tm ON tm.tenant_id = $1::uuid AND tm.module_key = m.module_key ' +
    'ORDER BY m.display_name';

  const result = await client.query<ModuleCatalogRow>(sql, [tenantId]);

  return result.rows.map((row) => ({
    moduleKey: row.module_key,
    displayName: row.display_name,
    description: row.description,
    manifest: row.manifest,
    availability: resolveTenantModuleAvailability({
      moduleEnabled: row.enabled,
      entitlementActive: row.entitlement_active,
      installationState: row.installation_state,
    }),
    installationState: row.installation_state,
    entitlement: {
      active: row.entitlement_active,
      sourceType: row.entitlement_source_type,
      sourceKey: row.entitlement_source_key,
    },
  }));
}

export async function loadTenantProductModule(
  client: PostgresClient,
  input: { readonly tenantId: string; readonly moduleKey: string },
): Promise<TenantProductModuleSummary | null> {
  const modules = await listTenantProductModules(client, input.tenantId);
  return modules.find((module) => module.moduleKey === input.moduleKey) ?? null;
}

export async function requireTenantModuleOperational(
  client: PostgresClient,
  input: { readonly tenantId: string; readonly moduleKey: string },
): Promise<TenantProductModuleSummary> {
  const module = await loadTenantProductModule(client, input);
  if (module === null) throw new Error('MODULE_UNAVAILABLE');
  if (!isTenantModuleOperational(module.availability)) {
    if (module.availability === 'LOCKED_BY_PLAN' || module.availability === 'SUSPENDED') {
      throw new Error('MODULE_LOCKED_BY_PLAN');
    }
    throw new Error('MODULE_NOT_ACTIVE');
  }
  return module;
}

interface TenantModuleRow {
  readonly tenant_module_id: string;
  readonly status: TenantModuleState;
}

interface TenantRow {
  readonly name: string;
  readonly vertical_key: string | null;
}

interface AcademyRow {
  readonly academy_id: string;
  readonly name: string;
  readonly slug: string;
  readonly source_vertical_key: string | null;
}

export interface LearningProvisioningResult {
  readonly tenantModuleId: string;
  readonly moduleKey: 'learning';
  readonly status: 'ACTIVE';
  readonly idempotent: boolean;
  readonly academy: {
    readonly academyId: string;
    readonly name: string;
    readonly slug: string;
    readonly sourceVerticalKey: string | null;
  };
}

export async function activateLearningModule(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
  },
): Promise<LearningProvisioningResult> {
  const current = await loadTenantProductModule(client, {
    tenantId: input.tenantId,
    moduleKey: 'learning',
  });
  if (current === null) throw new Error('MODULE_UNAVAILABLE');

  assertTenantModuleActivationAllowed(current.availability);

  if (current.availability === 'ACTIVE') {
    const installed = await client.query<TenantModuleRow>(
      "SELECT tenant_module_id, status FROM platform.tenant_modules WHERE tenant_id = $1::uuid AND module_key = 'learning'",
      [input.tenantId],
    );
    const moduleRow = installed.rows[0];
    if (moduleRow === undefined) throw new Error('LEARNING_MODULE_INSTALLATION_MISSING');
    const academy = await loadDefaultAcademy(client, input.tenantId);
    return toLearningProvisioningResult(moduleRow.tenant_module_id, academy, true);
  }

  await client.query(
    "INSERT INTO platform.tenant_modules (tenant_id, module_key, status, activation_requested_by_subject_id) " +
    "VALUES ($1::uuid, 'learning', 'ACTIVATION_PENDING', $2) " +
    "ON CONFLICT (tenant_id, module_key) DO NOTHING",
    [input.tenantId, input.actorSubjectId],
  );

  const locked = await client.query<TenantModuleRow>(
    "SELECT tenant_module_id, status FROM platform.tenant_modules " +
    "WHERE tenant_id = $1::uuid AND module_key = 'learning' FOR UPDATE",
    [input.tenantId],
  );
  const moduleRow = locked.rows[0];
  if (moduleRow === undefined) throw new Error('LEARNING_MODULE_INSTALLATION_MISSING');

  await client.query(
    "UPDATE platform.tenant_modules SET status = 'PROVISIONING', provisioning_error_key = NULL, " +
    "suspension_reason_key = NULL, deactivated_at = NULL, updated_at = now() " +
    "WHERE tenant_module_id = $1::uuid AND tenant_id = $2::uuid",
    [moduleRow.tenant_module_id, input.tenantId],
  );

  const tenantResult = await client.query<TenantRow>(
    'SELECT name, vertical_key FROM platform.tenants WHERE tenant_id = $1::uuid',
    [input.tenantId],
  );
  const tenant = tenantResult.rows[0];
  if (tenant === undefined) throw new Error('TENANT_NOT_FOUND');

  const academyName = tenant.name.trim() + ' Academy';
  const industryPackKey = tenant.vertical_key?.trim().toLowerCase() || null;

  await client.query(
    'INSERT INTO platform.learning_tenant_settings ' +
    '(tenant_id, tenant_module_id, academy_name, industry_pack_key, starter_pack_status) ' +
    'VALUES ($1::uuid, $2::uuid, $3, $4, $5) ON CONFLICT (tenant_id) DO NOTHING',
    [
      input.tenantId,
      moduleRow.tenant_module_id,
      academyName,
      industryPackKey,
      industryPackKey === null ? 'NOT_INSTALLED' : 'AVAILABLE',
    ],
  );

  await client.query(
    "INSERT INTO platform.learning_academies " +
    "(tenant_id, tenant_module_id, name, slug, is_default, source_vertical_key) " +
    "VALUES ($1::uuid, $2::uuid, $3, 'academy', true, $4) " +
    "ON CONFLICT (tenant_id, slug) DO NOTHING",
    [input.tenantId, moduleRow.tenant_module_id, academyName, industryPackKey],
  );

  const academy = await loadDefaultAcademy(client, input.tenantId);

  await client.query(
    "UPDATE platform.tenant_modules SET status = 'ACTIVE', activated_by_subject_id = $3, " +
    "activated_at = COALESCE(activated_at, now()), updated_at = now() " +
    "WHERE tenant_module_id = $1::uuid AND tenant_id = $2::uuid",
    [moduleRow.tenant_module_id, input.tenantId, input.actorSubjectId],
  );

  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'tenant.module',
      aggregateId: moduleRow.tenant_module_id,
      eventType: 'tenant.module.activated',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      payload: {
        moduleKey: 'learning',
        academyId: academy.academy_id,
        industryPackKey,
      },
      metadata: {
        source: 'tenant.module.activation',
        provisioner: 'learning.v1',
      },
    },
  });

  return toLearningProvisioningResult(moduleRow.tenant_module_id, academy, false);
}

async function loadDefaultAcademy(
  client: PostgresClient,
  tenantId: string,
): Promise<AcademyRow> {
  const result = await client.query<AcademyRow>(
    'SELECT academy_id, name, slug, source_vertical_key FROM platform.learning_academies ' +
    'WHERE tenant_id = $1::uuid AND is_default = true LIMIT 1',
    [tenantId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('LEARNING_DEFAULT_ACADEMY_MISSING');
  return row;
}

function toLearningProvisioningResult(
  tenantModuleId: string,
  academy: AcademyRow,
  idempotent: boolean,
): LearningProvisioningResult {
  return {
    tenantModuleId,
    moduleKey: 'learning',
    status: 'ACTIVE',
    idempotent,
    academy: {
      academyId: academy.academy_id,
      name: academy.name,
      slug: academy.slug,
      sourceVerticalKey: academy.source_vertical_key,
    },
  };
}

export interface LearningTenantContext {
  readonly module: TenantProductModuleSummary;
  readonly settings: {
    readonly academyName: string;
    readonly defaultLanguage: string;
    readonly defaultTimezone: string;
    readonly audienceTypes: readonly string[];
    readonly industryPackKey: string | null;
    readonly starterPackStatus: string;
    readonly aiFeaturesEnabled: boolean;
    readonly externalLearnersEnabled: boolean;
    readonly commerceEnabled: boolean;
    readonly communityEnabled: boolean;
  };
  readonly academy: LearningProvisioningResult['academy'];
}

interface LearningSettingsRow {
  readonly academy_name: string;
  readonly default_language: string;
  readonly default_timezone: string;
  readonly audience_types: readonly string[];
  readonly industry_pack_key: string | null;
  readonly starter_pack_status: string;
  readonly ai_features_enabled: boolean;
  readonly external_learners_enabled: boolean;
  readonly commerce_enabled: boolean;
  readonly community_enabled: boolean;
}

export async function loadLearningTenantContext(
  client: PostgresClient,
  tenantId: string,
): Promise<LearningTenantContext> {
  const module = await requireTenantModuleOperational(client, {
    tenantId,
    moduleKey: 'learning',
  });

  const settingsResult = await client.query<LearningSettingsRow>(
    'SELECT academy_name, default_language, default_timezone, audience_types, ' +
    'industry_pack_key, starter_pack_status, ai_features_enabled, external_learners_enabled, ' +
    'commerce_enabled, community_enabled FROM platform.learning_tenant_settings ' +
    'WHERE tenant_id = $1::uuid',
    [tenantId],
  );
  const settings = settingsResult.rows[0];
  if (settings === undefined) throw new Error('LEARNING_SETTINGS_MISSING');
  const academy = await loadDefaultAcademy(client, tenantId);

  return {
    module,
    settings: {
      academyName: settings.academy_name,
      defaultLanguage: settings.default_language,
      defaultTimezone: settings.default_timezone,
      audienceTypes: [...settings.audience_types],
      industryPackKey: settings.industry_pack_key,
      starterPackStatus: settings.starter_pack_status,
      aiFeaturesEnabled: settings.ai_features_enabled,
      externalLearnersEnabled: settings.external_learners_enabled,
      commerceEnabled: settings.commerce_enabled,
      communityEnabled: settings.community_enabled,
    },
    academy: {
      academyId: academy.academy_id,
      name: academy.name,
      slug: academy.slug,
      sourceVerticalKey: academy.source_vertical_key,
    },
  };
}
