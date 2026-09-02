import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { ACME_CORP_PACK } from '@expadio/industry-packs';
import { appendCrmCaseLifecycleEvent } from '../lib/crm-case-lifecycle-event';

function pool(): pg.Pool {
  return new pg.Pool({
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? 'postgres',
    database: process.env.PGDATABASE ?? 'expadio_test',
    max: 1,
  });
}

test('case lifecycle event uses pinned Pack version and queues atomically', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const caseId = randomUUID();
    const instanceId = randomUUID();

    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'Pinned lifecycle event tenant', 'acme-corp')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    const v2 = {
      ...ACME_CORP_PACK,
      label: 'Tenant ACME Corp v2',
      caseLifecycleEvents: [
        ...(ACME_CORP_PACK.caseLifecycleEvents ?? []).filter(
          (mapping) => mapping.stageKey !== 'RESOLVED',
        ),
        {
          stageKey: 'RESOLVED',
          eventType: 'TenantTreatment.DischargedV2',
          eventVersion: 2,
        },
      ],
    };
    const v3 = {
      ...v2,
      label: 'Tenant ACME Corp v3',
      caseLifecycleEvents: [
        ...(v2.caseLifecycleEvents ?? []).filter(
          (mapping) => mapping.stageKey !== 'RESOLVED',
        ),
        {
          stageKey: 'RESOLVED',
          eventType: 'TenantTreatment.DischargedV3',
          eventVersion: 3,
        },
      ],
    };

    for (const [version, state, definition] of [
      [2, 'SUPERSEDED', v2],
      [3, 'PUBLISHED', v3],
    ] as const) {
      await c.query(
        `INSERT INTO platform.industry_pack_versions (
           tenant_id, vertical_key, version, source, state, revision, definition,
           created_by_subject_id, updated_by_subject_id
         ) VALUES (
           $1::uuid, 'acme-corp', $2, 'TENANT_AUTHORED', $3, 1, $4::jsonb,
           'itest-author', 'itest-author'
         )`,
        [tenantId, version, state, JSON.stringify(definition)],
      );
    }

    await c.query('BEGIN');
    try {
      const appended = await appendCrmCaseLifecycleEvent(c, {
        tenantId,
        caseId,
        workflowInstanceId: instanceId,
        fromStageKey: 'REVIEW',
        toStageKey: 'RESOLVED',
        actorSubjectId: 'reviewer-1',
        correlationId: 'journey-1',
        provenance: {
          verticalKey: 'acme-corp',
          version: 2,
          runtimeSource: 'TENANT_PUBLISHED',
        },
        occurredAt: new Date('2026-08-30T12:00:00.000Z'),
      });
      assert.ok(appended);
      assert.equal(appended.event.eventType, 'TenantTreatment.DischargedV2');
      assert.equal(appended.event.eventVersion, 2);
      assert.equal(appended.event.packVersion, 2);
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    }

    const persisted = (await c.query(
      `SELECT
         event.event_type,
         event.event_version,
         event.pack_key,
         event.pack_version,
         event.payload,
         outbox.status AS outbox_status
       FROM platform.domain_events event
       JOIN platform.domain_event_outbox outbox
         ON outbox.tenant_id = event.tenant_id
        AND outbox.event_id = event.event_id
      WHERE event.tenant_id = $1::uuid
        AND event.aggregate_id = $2`,
      [tenantId, caseId],
    )).rows[0];

    assert.deepEqual(persisted, {
      event_type: 'TenantTreatment.DischargedV2',
      event_version: 2,
      pack_key: 'acme-corp',
      pack_version: 2,
      payload: {
        workflowInstanceId: instanceId,
        fromStageKey: 'REVIEW',
        toStageKey: 'RESOLVED',
      },
      outbox_status: 'PENDING',
    });

    const neutral = await appendCrmCaseLifecycleEvent(c, {
      tenantId,
      caseId: randomUUID(),
      workflowInstanceId: randomUUID(),
      fromStageKey: 'REVIEW',
      toStageKey: 'RESOLVED',
      actorSubjectId: 'reviewer-1',
      correlationId: 'journey-neutral',
      provenance: {
        verticalKey: null,
        version: null,
        runtimeSource: 'NEUTRAL',
      },
    });
    assert.equal(neutral, null);
  } finally {
    c.release();
    await p.end();
  }
});
