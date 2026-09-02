import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { resolveGovernedAction } from '@expadio/governed-actions';
import {
  appendDomainEventWithOutbox,
  loadDomainEvent,
} from '@expadio/postgres-runtime/domain-events';
import {
  listGovernedActionIntentsForEvent,
  persistGovernedActionIntent,
} from '@expadio/postgres-runtime/governed-action-intent';

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

test('Domain Event resolves to one replay-safe governed Action Intent after policy approval', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const treatmentId = randomUUID();
    const eventId = randomUUID();
    const actor = `${tenantId.slice(0, 8)}-reviewer`;
    const correlationId = randomUUID();

    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'Governed action tenant', 'acme-corp')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    await c.query('BEGIN');
    try {
      await appendDomainEventWithOutbox(c, {
        event: {
          eventId,
          tenantId,
          aggregateType: 'crm.case',
          aggregateId: treatmentId,
          eventType: 'Treatment.Discharged',
          eventVersion: 1,
          occurredAt: new Date('2026-08-30T09:00:00.000Z'),
          actorSubjectId: actor,
          correlationId,
          causationId: 'workflow-transition',
          packKey: 'acme-corp',
          payload: {
            stage: 'RESOLVED',
            patientSubjectId: 'patient-1',
          },
        },
      });
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    }

    const event = await loadDomainEvent(c, { tenantId, eventId });
    assert.ok(event);

    const rule = {
      ruleKey: 'acme-corp.discharge.follow-up',
      eventType: 'Treatment.Discharged',
      executorClass: 'COMMUNICATE' as const,
      actionKey: 'patient.follow_up',
      enabled: true,
      policyKeys: ['patient-contactable', 'quiet-hours'],
      configuration: {
        purpose: 'TRANSACTIONAL',
        triggerKey: 'patient.follow_up',
      },
    };

    const resolved = resolveGovernedAction(event, rule, {
      allowed: true,
      policyKeys: ['patient-contactable', 'quiet-hours'],
      evidenceRefs: ['consent:active', 'quiet-hours:allowed'],
      reasonCode: 'ALLOWED',
      evaluatedAt: new Date('2026-08-30T09:00:01.000Z'),
    });
    assert.ok(resolved.matched && resolved.allowed);
    if (!resolved.matched || !resolved.allowed) {
      throw new Error('Expected an allowed governed action');
    }

    const first = await persistGovernedActionIntent(c, resolved.intent);
    const replay = await persistGovernedActionIntent(c, resolved.intent);

    assert.equal(replay.actionIntentId, first.actionIntentId);
    assert.equal(first.sourceEventId, eventId);
    assert.equal(first.executorClass, 'COMMUNICATE');
    assert.equal(first.actionKey, 'patient.follow_up');
    assert.equal(first.causationId, eventId);
    assert.equal(first.correlationId, correlationId);
    assert.deepEqual(first.policyDecision.evidenceRefs, [
      'consent:active',
      'quiet-hours:allowed',
    ]);

    const intents = await listGovernedActionIntentsForEvent(c, {
      tenantId,
      sourceEventId: eventId,
    });
    assert.equal(intents.length, 1);
    assert.equal(intents[0]?.actionIntentId, first.actionIntentId);

    const denied = resolveGovernedAction(
      event,
      {
        ...rule,
        ruleKey: 'acme-corp.discharge.sms',
        actionKey: 'patient.follow_up.sms',
      },
      {
        allowed: false,
        policyKeys: ['patient-contactable'],
        evidenceRefs: ['suppression:sms'],
        reasonCode: 'SUPPRESSED',
        evaluatedAt: new Date('2026-08-30T09:00:02.000Z'),
      },
    );
    assert.deepEqual(denied, {
      matched: true,
      allowed: false,
      reasonCode: 'SUPPRESSED',
    });

    const afterDenied = await listGovernedActionIntentsForEvent(c, {
      tenantId,
      sourceEventId: eventId,
    });
    assert.equal(afterDenied.length, 1);

    await assert.rejects(
      () => c.query(
        `UPDATE platform.governed_action_intents
            SET action_key = 'tampered'
          WHERE tenant_id = $1::uuid
            AND action_intent_id = $2::uuid`,
        [tenantId, first.actionIntentId],
      ),
      /governed action intents are append-only/,
    );

    const outboxAndIntent = (await c.query(
      `SELECT
         outbox.status AS outbox_status,
         count(intent.action_intent_id)::int AS action_intents
       FROM platform.domain_event_outbox outbox
       LEFT JOIN platform.governed_action_intents intent
         ON intent.tenant_id = outbox.tenant_id
        AND intent.source_event_id = outbox.event_id
      WHERE outbox.tenant_id = $1::uuid
        AND outbox.event_id = $2::uuid
      GROUP BY outbox.status`,
      [tenantId, eventId],
    )).rows[0];

    assert.deepEqual(outboxAndIntent, {
      outbox_status: 'PENDING',
      action_intents: 1,
    });
  } finally {
    c.release();
    await p.end();
  }
});
