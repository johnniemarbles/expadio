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
  executePersistedCommunicateAction,
} from '@expadio/postgres-runtime/governed-communicate-action';
import {
  listGovernedActionExecutionAttempts,
} from '@expadio/postgres-runtime/governed-action-execution-attempt';
import {
  PostgresCommunicationSuppressionRepository,
} from '@expadio/postgres-runtime/suppression';

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

test('governed COMMUNICATE action uses existing compliance/template/dispatch boundary with retry attempts', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantId = randomUUID();
    const eventId = randomUUID();
    const treatmentId = randomUUID();
    const actor = `${tenantId.slice(0, 8)}-reviewer`;
    const patientEmail = 'followup.patient@example.test';

    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'Governed communicate tenant', 'dentex')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    await c.query(
      `INSERT INTO platform.communication_templates (
         scope, tenant_id, organization_id, trigger_key, channel, locale,
         content_format, subject, title, body, required_variables,
         default_variables, status
       ) VALUES (
         'TENANT', $1::uuid, NULL, 'patient.follow_up', 'email', 'en',
         'TEXT', 'Treatment follow-up', NULL,
         'Hello {{patientName}}, your treatment follow-up is ready.',
         '["patientName"]'::jsonb, '{}'::jsonb, 'ACTIVE'
       )`,
      [tenantId],
    );

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
          occurredAt: new Date('2026-08-30T11:00:00.000Z'),
          actorSubjectId: actor,
          correlationId: randomUUID(),
          packKey: 'dentex',
          payload: {
            patientEmail,
            patientName: 'Jane',
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

    const resolution = resolveGovernedAction(
      event,
      {
        ruleKey: 'dentex.discharge.follow-up',
        eventType: 'Treatment.Discharged',
        executorClass: 'COMMUNICATE',
        actionKey: 'patient.follow_up',
        enabled: true,
        policyKeys: ['patient-contactable'],
        configuration: {
          triggerKey: 'patient.follow_up',
          recipient: { email: patientEmail },
          variables: { patientName: 'Jane' },
          purpose: 'transactional',
          consentRequired: false,
          channel: 'email',
          locale: 'en',
          capabilityKey: 'communication.email.send',
        },
      },
      {
        allowed: true,
        policyKeys: ['patient-contactable'],
        evidenceRefs: ['patient:email'],
        reasonCode: 'ALLOWED',
        evaluatedAt: new Date('2026-08-30T11:00:01.000Z'),
      },
    );
    assert.ok(resolution.matched && resolution.allowed);
    if (!resolution.matched || !resolution.allowed) {
      throw new Error('expected governed communication intent');
    }

    const persistedIntent = await persistGovernedActionIntent(c, resolution.intent);

    const dispatchCalls: Array<{ idempotencyKey: string; body: string }> = [];
    const dispatch = {
      async dispatch(input: any) {
        dispatchCalls.push({
          idempotencyKey: input.idempotencyKey,
          body: input.rendered.body,
        });
        return {
          state: 'QUEUED' as const,
          reasonCode: 'OK' as const,
          messageId: 'queued-message-1',
          providerKey: 'communications-runtime',
          queuedAt: '2026-08-30T11:00:02.000Z',
        };
      },
    };

    const first = await executePersistedCommunicateAction(c, {
      actionIntent: persistedIntent,
      dispatch,
    });
    assert.equal(first.attempt.attemptNumber, 1);
    assert.equal(first.attempt.state, 'SUCCEEDED');
    assert.equal(first.execution.executed, true);
    if (!first.execution.executed) throw new Error('expected queued dispatch');
    assert.equal(
      first.execution.preparedDispatch.idempotencyKey,
      persistedIntent.idempotencyKey,
    );
    assert.equal(
      first.execution.preparedDispatch.rendered.body,
      'Hello Jane, your treatment follow-up is ready.',
    );

    const replay = await executePersistedCommunicateAction(c, {
      actionIntent: persistedIntent,
      dispatch,
    });
    assert.equal(replay.attempt.attemptNumber, 2);
    assert.equal(replay.attempt.state, 'SUCCEEDED');
    assert.equal(dispatchCalls.length, 2);
    assert.equal(dispatchCalls[0]?.idempotencyKey, persistedIntent.idempotencyKey);
    assert.equal(dispatchCalls[1]?.idempotencyKey, persistedIntent.idempotencyKey);

    const attempts = await listGovernedActionExecutionAttempts(c, {
      tenantId,
      actionIntentId: persistedIntent.actionIntentId,
    });
    assert.deepEqual(
      attempts.map((attempt) => [attempt.attemptNumber, attempt.state]),
      [
        [1, 'SUCCEEDED'],
        [2, 'SUCCEEDED'],
      ],
    );

    await new PostgresCommunicationSuppressionRepository(c).add({
      tenantId,
      recipientKey: patientEmail,
      channel: 'email',
      reason: 'OPT_OUT',
      recordedAt: '2026-08-30T11:00:03.000Z',
    });

    const suppressed = await executePersistedCommunicateAction(c, {
      actionIntent: {
        ...persistedIntent,
        actionIntentId: persistedIntent.actionIntentId,
        requestedAt: new Date('2026-08-30T11:00:04.000Z'),
      },
      dispatch,
    });
    assert.equal(suppressed.attempt.attemptNumber, 3);
    assert.equal(suppressed.attempt.state, 'REFUSED');
    assert.equal(suppressed.execution.executed, false);
    if (suppressed.execution.executed) throw new Error('expected suppression refusal');
    assert.equal(suppressed.execution.reasonCode, 'SUPPRESSED');
    assert.equal(dispatchCalls.length, 2);

    const immutableIntent = (await c.query(
      `SELECT count(*)::int AS count
         FROM platform.governed_action_intents
        WHERE tenant_id = $1::uuid
          AND action_intent_id = $2::uuid`,
      [tenantId, persistedIntent.actionIntentId],
    )).rows[0]?.count;
    assert.equal(immutableIntent, 1);
  } finally {
    c.release();
    await p.end();
  }
});
