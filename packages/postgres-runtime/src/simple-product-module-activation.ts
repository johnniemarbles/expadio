import { randomUUID } from 'node:crypto';
import { assertTenantModuleActivationAllowed } from '@expadio/capabilities';
import type { PostgresClient } from './index.ts';
import { appendDomainEventWithOutbox } from './domain-events.ts';
import { loadTenantProductModule } from './product-module.ts';

export interface SimpleProductModuleActivationResult {
  readonly tenantModuleId: string;
  readonly moduleKey: string;
  readonly status: 'ACTIVE';
  readonly idempotent: boolean;
}

export async function activateSimpleProductModule(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly moduleKey: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
  },
): Promise<SimpleProductModuleActivationResult> {
  const current = await loadTenantProductModule(client, {
    tenantId: input.tenantId,
    moduleKey: input.moduleKey,
  });
  if (current === null) throw new Error('MODULE_UNAVAILABLE');
  assertTenantModuleActivationAllowed(current.availability);

  if (current.availability === 'ACTIVE') {
    const installed = await client.query<{ tenant_module_id: string }>(
      `SELECT tenant_module_id
         FROM platform.tenant_modules
        WHERE tenant_id = $1::uuid AND module_key = $2`,
      [input.tenantId, input.moduleKey],
    );
    const row = installed.rows[0];
    if (!row) throw new Error('MODULE_INSTALLATION_MISSING');
    return { tenantModuleId: row.tenant_module_id, moduleKey: input.moduleKey, status: 'ACTIVE', idempotent: true };
  }

  const installed = await client.query<{ tenant_module_id: string }>(
    `INSERT INTO platform.tenant_modules
       (tenant_id, module_key, status, activation_requested_by_subject_id,
        activated_by_subject_id, activated_at)
     VALUES ($1::uuid, $2, 'ACTIVE', $3, $3, now())
     ON CONFLICT (tenant_id, module_key) DO UPDATE
       SET status = 'ACTIVE',
           activated_by_subject_id = EXCLUDED.activated_by_subject_id,
           activated_at = COALESCE(platform.tenant_modules.activated_at, now()),
           deactivated_at = NULL,
           suspension_reason_key = NULL,
           provisioning_error_key = NULL,
           updated_at = now()
     RETURNING tenant_module_id`,
    [input.tenantId, input.moduleKey, input.actorSubjectId],
  );
  const row = installed.rows[0];
  if (!row) throw new Error('MODULE_INSTALLATION_MISSING');

  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'tenant.module',
      aggregateId: row.tenant_module_id,
      eventType: 'tenant.module.activated',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      payload: { moduleKey: input.moduleKey },
      metadata: { source: 'tenant.module.simple-activation' },
    },
  });

  return { tenantModuleId: row.tenant_module_id, moduleKey: input.moduleKey, status: 'ACTIVE', idempotent: false };
}
