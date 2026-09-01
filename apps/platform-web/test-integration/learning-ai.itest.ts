import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { activateLearningModule } from '@expadio/postgres-runtime/product-module';
import { createLearningLearner } from '@expadio/postgres-runtime/learning-enrollment';
import {
  createLearningAiRequest,
  loadLearningAiRequestStatus,
  updateLearningAiSettings,
} from '@expadio/postgres-runtime/learning-ai';
import { runAiJobWorkerOnce } from '../lib/ai-job-worker';

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

async function tx<T>(
  client: pg.PoolClient,
  work: () => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    const value = await work();
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

test('Learning tutor request executes through governed durable AI worker', async () => {
  const db = pool();
  const client = await db.connect();

  const tenantId = randomUUID();
  const learnerSubjectId = `learner-${randomUUID()}`;
  const learnerIssuer = 'https://clerk.expadio.com';
  const serviceSubjectId = `ai-worker-${randomUUID()}`;
  const connectorKey = `openai-learning-${randomUUID()}`;
  const roleKey = `ai-worker-role-${randomUUID()}`;
  const credentialRef =
    `vault://tenant/${tenantId}/connector/${connectorKey}/v1`;

  try {
    await client.query(
      `INSERT INTO platform.tenants (tenant_id, name)
       VALUES ($1::uuid, 'Learning AI Integration Tenant')`,
      [tenantId],
    );
    await client.query(
      `INSERT INTO platform.tenant_module_entitlements (
         tenant_id, module_key, source_type, source_key, status
       ) VALUES (
         $1::uuid, 'learning', 'PLAN', 'itest-learning-ai', 'ACTIVE'
       )`,
      [tenantId],
    );
    await client.query(
      `SELECT set_config('app.tenant_id', $1, false)`,
      [tenantId],
    );

    await tx(client, () =>
      activateLearningModule(client, {
        tenantId,
        actorSubjectId: 'learning-admin',
        correlationId: randomUUID(),
      }),
    );
    await tx(client, () =>
      updateLearningAiSettings(client, {
        tenantId,
        aiFeaturesEnabled: true,
      }),
    );

    const learner = await tx(client, () =>
      createLearningLearner(client, {
        tenantId,
        actorSubjectId: 'learning-admin',
        learner: {
          subjectId: learnerSubjectId,
          subjectIssuer: learnerIssuer,
          fullName: 'AI Tutor Learner',
          email: 'ai.tutor.learner@example.test',
          audienceType: 'INTERNAL',
        },
      }),
    );

    const capability = await client.query<{ capability_id: string }>(
      `INSERT INTO platform.capabilities (
         capability_key, display_name, permitted_modes, enabled
       ) VALUES (
         'ai.generate', 'AI Generate', ARRAY['A']::text[], true
       )
       ON CONFLICT (capability_key)
       DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING capability_id`,
    );
    const connector = await client.query<{ connector_id: string }>(
      `INSERT INTO platform.connectors (
         connector_key, provider_type, provider_key, ownership_scope,
         tenant_id, health, priority, enabled, fallback_enabled
       ) VALUES (
         $1, 'openai', 'openai', 'TENANT', $2::uuid,
         'HEALTHY', 1, true, false
       )
       RETURNING connector_id`,
      [connectorKey, tenantId],
    );
    await client.query(
      `INSERT INTO platform.connector_capabilities (
         connector_id, capability_id
       ) VALUES ($1::uuid, $2::uuid)`,
      [connector.rows[0]!.connector_id, capability.rows[0]!.capability_id],
    );
    await client.query(
      `INSERT INTO platform.connector_credentials (
         connector_id, credential_ref, key_version, custody_mode, state
       ) VALUES ($1::uuid, $2, 'v1', 'PLATFORM_MANAGED', 'ACTIVE')`,
      [connector.rows[0]!.connector_id, credentialRef],
    );

    const role = await client.query<{ role_id: string }>(
      `INSERT INTO platform.authorization_roles (
         role_key, display_name, ownership_scope, tenant_id, status
       ) VALUES ($1, 'Learning AI worker', 'TENANT', $2::uuid, 'ACTIVE')
       RETURNING role_id`,
      [roleKey, tenantId],
    );
    await client.query(
      `INSERT INTO platform.authorization_role_capabilities (
         role_id, action, resource_type
       ) VALUES ($1::uuid, 'credential.lease', 'connector-credential')`,
      [role.rows[0]!.role_id],
    );
    await client.query(
      `INSERT INTO platform.authorization_assignments (
         tenant_id, organization_id, subject_id, role_id, status,
         clearances, sensitive_compartments
       ) VALUES (
         $1::uuid, NULL, $2, $3::uuid, 'ACTIVE',
         ARRAY['sensitive']::text[],
         ARRAY['provider-credentials']::text[]
       )`,
      [tenantId, serviceSubjectId, role.rows[0]!.role_id],
    );

    const request = await tx(client, () =>
      createLearningAiRequest(client, {
        tenantId,
        actorSubjectId: learnerSubjectId,
        actorIssuer: learnerIssuer,
        correlationId: randomUUID(),
        requestType: 'TUTOR',
        prompt: 'Explain the difference between recall and precision.',
        idempotencyKey: 'tutor-precision-recall-1',
      }),
    );
    assert.equal(request.created, true);
    assert.equal(request.request.learnerId, learner.learnerId);
    assert.match(request.request.inputArtifactReference, /^ai-artifact:\/\//);

    let providerCalls = 0;
    let secretReads = 0;
    const worker = await runAiJobWorkerOnce(client, {
      tenantId,
      options: {
        serviceSubjectId,
        now: () => new Date('2026-09-01T03:30:00.000Z'),
        secretResolver: {
          async resolve(reference) {
            secretReads += 1;
            assert.equal(reference, credentialRef);
            return { value: 'sk-learning-ai-itest' };
          },
        },
        fetchImpl: async (input, init) => {
          providerCalls += 1;
          assert.equal(
            String(input),
            'https://api.openai.com/v1/chat/completions',
          );
          const headers = new Headers(init?.headers);
          assert.equal(
            headers.get('Authorization'),
            'Bearer sk-learning-ai-itest',
          );
          const payload = JSON.parse(String(init?.body)) as {
            model: string;
            messages: Array<{ role: string; content: string }>;
          };
          assert.equal(payload.model, 'gpt-4o-mini');
          assert.equal(
            payload.messages.at(-1)?.content,
            'Explain the difference between recall and precision.',
          );
          return new Response(
            JSON.stringify({
              choices: [{
                message: {
                  content:
                    'Recall measures relevant items found; precision measures how many found items are relevant.',
                },
              }],
              usage: { total_tokens: 120 },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        },
      },
    });

    assert.equal(worker.status, 'SUCCEEDED');
    if (worker.status !== 'SUCCEEDED') {
      throw new Error('expected successful AI worker result');
    }
    assert.equal(worker.connectorKey, connectorKey);
    assert.equal(providerCalls, 1);
    assert.equal(secretReads, 1);
    assert.match(worker.outputReference, /^ai-artifact:\/\//);

    const status = await tx(client, () =>
      loadLearningAiRequestStatus(client, {
        tenantId,
        learningAiRequestId: request.request.learningAiRequestId,
        actorSubjectId: learnerSubjectId,
        actorIssuer: learnerIssuer,
      }),
    );
    assert.equal(status.jobStatus, 'SUCCEEDED');
    assert.equal(
      status.output?.content,
      'Recall measures relevant items found; precision measures how many found items are relevant.',
    );
    assert.equal(status.confidence, 0.95);
    assert.equal(status.costMinorUnits, 1);

    const evidence = await client.query<{
      input_reference: string;
      output_artifacts: number;
      started_events: number;
      succeeded_events: number;
      usage_events: number;
      completed_queue_rows: number;
      credential_lease_events: number;
    }>(
      `SELECT
         (SELECT input_reference FROM platform.ai_jobs
           WHERE tenant_id = $1::uuid AND job_id = $2::uuid)
           AS input_reference,
         (SELECT count(*)::int FROM platform.ai_job_artifacts
           WHERE tenant_id = $1::uuid AND job_id = $2::uuid
             AND artifact_type = 'OUTPUT') AS output_artifacts,
         (SELECT count(*)::int FROM platform.ai_job_events
           WHERE tenant_id = $1::uuid AND job_id = $2::uuid
             AND event_type = 'STARTED') AS started_events,
         (SELECT count(*)::int FROM platform.ai_job_events
           WHERE tenant_id = $1::uuid AND job_id = $2::uuid
             AND event_type = 'SUCCEEDED') AS succeeded_events,
         (SELECT count(*)::int FROM platform.intelligence_usage_events
           WHERE tenant_id = $1::uuid AND work_reference = $3
             AND meter = 'AI_REQUEST') AS usage_events,
         (SELECT count(*)::int FROM platform.ai_job_execution_queue
           WHERE tenant_id = $1::uuid AND job_id = $2::uuid
             AND status = 'COMPLETED') AS completed_queue_rows,
         (SELECT count(*)::int FROM platform.credential_lease_events
           WHERE tenant_id = $1::uuid
             AND requested_by_subject_id = $4)
           AS credential_lease_events`,
      [
        tenantId,
        request.request.jobId,
        `ai-job:${request.request.jobId}`,
        serviceSubjectId,
      ],
    );

    assert.match(evidence.rows[0]!.input_reference, /^ai-artifact:\/\//);
    assert.doesNotMatch(evidence.rows[0]!.input_reference, /recall|precision/i);
    assert.equal(evidence.rows[0]!.output_artifacts, 1);
    assert.equal(evidence.rows[0]!.started_events, 1);
    assert.equal(evidence.rows[0]!.succeeded_events, 1);
    assert.equal(evidence.rows[0]!.usage_events, 1);
    assert.equal(evidence.rows[0]!.completed_queue_rows, 1);
    assert.equal(evidence.rows[0]!.credential_lease_events, 1);

    const secondPass = await runAiJobWorkerOnce(client, {
      tenantId,
      options: {
        serviceSubjectId,
        secretResolver: {
          async resolve() {
            assert.fail('completed job must not resolve credentials again');
          },
        },
        fetchImpl: async () => {
          assert.fail('completed job must not call provider again');
        },
      },
    });
    assert.equal(secondPass.status, 'IDLE');

    await tx(client, () =>
      updateLearningAiSettings(client, {
        tenantId,
        aiFeaturesEnabled: false,
      }),
    );

    await assert.rejects(
      () =>
        tx(client, () =>
          createLearningAiRequest(client, {
            tenantId,
            actorSubjectId: learnerSubjectId,
            actorIssuer: learnerIssuer,
            correlationId: randomUUID(),
            requestType: 'TUTOR',
            prompt: 'This should be blocked.',
            idempotencyKey: 'tutor-disabled-1',
          }),
        ),
      /LEARNING_AI_FEATURES_DISABLED/,
    );

    const historical = await tx(client, () =>
      loadLearningAiRequestStatus(client, {
        tenantId,
        learningAiRequestId: request.request.learningAiRequestId,
        actorSubjectId: learnerSubjectId,
        actorIssuer: learnerIssuer,
      }),
    );
    assert.equal(historical.jobStatus, 'SUCCEEDED');
    assert.equal(historical.output?.content, status.output?.content);
  } finally {
    client.release();
    await db.end();
  }
});
