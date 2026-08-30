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
  persistGovernedActionIntent,
} from '@expadio/postgres-runtime/governed-action-intent';
import {
  listGovernedActionExecutionAttempts,
} from '@expadio/postgres-runtime/governed-action-execution';
import { PostgresCommunicationSuppressionRepository } from '@expadio/postgres-runtime/suppression';
import { executeGovernedCommunicateAction } from '../lib/governed-communicate-executor';

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

test('COMMUNICATE Action Intent queues once and late suppression still wins', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const treatmentId = randomUUID();
    const actor = `${tenantId.slice(0, 8)}-reviewer`;
    const capabilityKey = 'communication.email.send';
    const connectorKey = `resend-${randomUUID()}`;
    const recipient = 'patient-follow-up@example.test';

    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'Governed communicate tenant', 'dentex')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    const capabilityId = (await c.query(
      `INSERT INTO platform.capabilities (capability_key, display_name)
       VALUES ($1, 'Communication email send')
       ON CONFLICT (capability_key)
       DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING capability_id`,
      [capabilityKey],
    )).rows[0].capability_id as string;

    const connectorId = (await c.query(
      `INSERT INTO platform.connectors (
         connector_key, provider_type, provider_key, ownership_scope, tenant_id,
         health, priority, enabled, fallback_enabled
       ) VALUES (
         $1, 'email', 'resend', 'TENANT', $2::uuid,
         'HEALTHY', 1, true, false
       )
       RETURNING connector_id`,
      [connectorKey, tenantId],
    )).rows[0].connector_id as string;

    await c.query(
      `INSERT INTO platform.connector_capabilities (connector_id, capability_id)
       VALUES ($1::uuid, $2::uuid)`,
      [connectorId, capabilityId],
    );

    await c.query(
      `INSERT INTO platform.communication_templates (
         scope, tenant_id, trigger_key, channel, locale, content_format,
         subject, body, required_variables, default_variables, status
       ) VALUES (
         'TENANT', $1::uuid, 'patient.follow_up', 'email', 'en', 'TEXT',
         'Your treatment follow-up',
         'Hello {{patientName}}, your follow-up is ready.',
         '["patientName"]'::jsonb, '{}'::jsonb, 'ACTIVE'
       )`,
      [tenantId],
    );

    const makeIntent = async (input: {
      eventId: string;
      ruleKey: string;
      occurredAt: string;
      evaluatedAt: string;
    }) => {
      await c.query('BEGIN');
      try {
        await appendDomainEventWithOutbox(c, {
          event: {
            eventId: input.eventId,
            tenantId,
            aggregateType: 'crm.case',
            aggregateId: treatmentId,
            eventType: 'Treatment.Discharged',
            eventVersion: 1,
            occurredAt: new Date(input.occurredAt),
            actorSubjectId: actor,
            correlationId: randomUUID(),
            causationId: 'workflow-transition',
            packKey: 'dentex',
            payload: {
              patientEmail: recipient,
              patientName: 'Mira',
              stage: 'RESOLVED',
            },
          },
        });
        await c.query('COMMIT');
      } catch (error) {
        await c.query('ROLLBACK');
        throw error;
      }

      const event = await loadDomainEvent(c, {
        tenantId,
        eventId: input.eventId,
      });
      assert.ok(event);

      const resolved = resolveGovernedAction(
        event,
        {
          ruleKey: input.ruleKey,
          eventType: 'Treatment.Discharged',
          executorClass: 'COMMUNICATE',
          actionKey: 'patient.follow_up',
          enabled: true,
          policyKeys: [],
          configuration: {
            triggerKey: 'patient.follow_up',
            recipient: { email: recipient },
            variables: { patientName: 'Mira' },
            purpose: 'transactional',
            consentRequired: false,
            channel: 'email',
            capabilityKey,
          },
        },
        {
          allowed: true,
          policyKeys: [],
          evidenceRefs: ['workflow:discharged'],
          reasonCode: 'ALLOWED',
          evaluatedAt: new Date(input.evaluatedAt),
        },
      );
      assert.ok(resolved.matched && resolved.allowed);
      if (!resolved.matched || !resolved.allowed) {
        throw new Error('expected COMMUNICATE action to be allowed');
      }

      return persistGovernedActionIntent(c, resolved.intent);
    };

    const firstIntent = await makeIntent({
      eventId: randomUUID(),
      ruleKey: 'dentex.discharge.follow-up.email',
      occurredAt: '2026-08-30T10:00:00.000Z',
      evaluatedAt: '2026-08-30T10:00:01.000Z',
    });

    const first = await executeGovernedCommunicateAction(c, {
      intent: firstIntent,
      now: () => '2026-08-30T10:00:02.000Z',
    });

    assert.equal(first.replayed, false);
    assert.equal(first.queue?.queued, true);
    if (first.queue === null || !first.queue.queued) {
      throw new Error('expected first communication to queue');
    }
    assert.equal(first.queue.delivery.state, 'PENDING');
    assert.equal(first.queue.delivery.connectorKey, connectorKey);
    assert.equal(first.queue.delivery.adapterKey, 'resend-email-v1');
    assert.equal(first.queue.preparedDispatch.idempotencyKey, firstIntent.idempotencyKey);
    assert.equal(first.attempt.status, 'QUEUED');
    assert.equal(first.attempt.reasonCode, 'COMMUNICATION_QUEUED');
    assert.equal(
      first.attempt.outputReference,
      `communication.delivery:${first.queue.delivery.deliveryId}`,
    );

    const replay = await executeGovernedCommunicateAction(c, {
      intent: firstIntent,
      now: () => '2026-08-30T10:00:03.000Z',
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.queue, null);
    assert.equal(replay.attempt.executionAttemptId, first.attempt.executionAttemptId);

    const firstCounts = (await c.query(
      `SELECT
         (SELECT count(*)::int
            FROM platform.communication_deliveries
           WHERE tenant_id = $1::uuid
             AND idempotency_key = $2) AS deliveries,
         (SELECT count(*)::int
            FROM platform.governed_action_execution_attempts
           WHERE tenant_id = $1::uuid
             AND action_intent_id = $3::uuid) AS attempts`,
      [tenantId, firstIntent.idempotencyKey, firstIntent.actionIntentId],
    )).rows[0];
    assert.deepEqual(firstCounts, {
      deliveries: 1,
      attempts: 1,
    });

    const secondIntent = await makeIntent({
      eventId: randomUUID(),
      ruleKey: 'dentex.discharge.follow-up.email.second',
      occurredAt: '2026-08-30T10:01:00.000Z',
      evaluatedAt: '2026-08-30T10:01:01.000Z',
    });

    await new PostgresCommunicationSuppressionRepository(c).add({
      tenantId,
      recipientKey: recipient,
      channel: 'email',
      reason: 'OPT_OUT',
      recordedAt: '2026-08-30T10:01:30.000Z',
    });

    const suppressed = await executeGovernedCommunicateAction(c, {
      intent: secondIntent,
      now: () => '2026-08-30T10:02:00.000Z',
    });

    assert.equal(suppressed.replayed, false);
    assert.equal(suppressed.queue?.queued, false);
    if (suppressed.queue === null || suppressed.queue.queued) {
      throw new Error('expected late suppression to refuse the communication');
    }
    assert.equal(suppressed.queue.reasonCode, 'SUPPRESSED');
    assert.equal(suppressed.attempt.status, 'REFUSED');
    assert.equal(suppressed.attempt.reasonCode, 'SUPPRESSED');
    assert.equal(suppressed.attempt.outputReference, null);

    const secondCounts = (await c.query(
      `SELECT
         (SELECT count(*)::int
            FROM platform.communication_deliveries
           WHERE tenant_id = $1::uuid
             AND idempotency_key = $2) AS deliveries,
         (SELECT count(*)::int
            FROM platform.governed_action_execution_attempts
           WHERE tenant_id = $1::uuid
             AND action_intent_id = $3::uuid) AS attempts`,
      [tenantId, secondIntent.idempotencyKey, secondIntent.actionIntentId],
    )).rows[0];
    assert.deepEqual(secondCounts, {
      deliveries: 0,
      attempts: 1,
    });

    const attempts = await listGovernedActionExecutionAttempts(c, {
      tenantId,
      actionIntentId: firstIntent.actionIntentId,
    });
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]?.status, 'QUEUED');

    await assert.rejects(
      () => c.query(
        `UPDATE platform.governed_action_execution_attempts
            SET reason_code = 'tampered'
          WHERE tenant_id = $1::uuid
            AND execution_attempt_id = $2::uuid`,
        [tenantId, first.attempt.executionAttemptId],
      ),
      /governed action execution attempts are append-only/,
    );
  } finally {
    c.release();
    await p.end();
  }
});
