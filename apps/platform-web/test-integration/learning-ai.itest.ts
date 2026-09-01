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
import {
  createGovernedSupabaseArtifactStore,
} from '../lib/governed-artifact-storage';
import {
  findExecutionArtifactBySource,
} from '@expadio/postgres-runtime/execution-artifact';

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
  const organizationId = randomUUID();
  const learnerSubjectId = `learner-${randomUUID()}`;
  const learnerIssuer = 'https://clerk.expadio.com';
  const serviceSubjectId = `ai-worker-${randomUUID()}`;
  const connectorKey = `openai-learning-${randomUUID()}`;
  const storageConnectorKey =
    `supabase-artifacts-${randomUUID()}`;
  const roleKey = `ai-worker-role-${randomUUID()}`;
  const credentialRef =
    `vault://tenant/${tenantId}/connector/${connectorKey}/v1`;
  const storageCredentialRef =
    `vault://tenant/${tenantId}/connector/${storageConnectorKey}/v1`;
  const storageProjectUrl = 'https://learning-ai-storage.example.test';
  const storageBucket = 'learning-ai-artifacts';
  const storedObjects = new Map<string, Uint8Array>();

  try {
    await client.query(
      `INSERT INTO platform.tenants (tenant_id, name)
       VALUES ($1::uuid, 'Learning AI Integration Tenant')`,
      [tenantId],
    );
    await client.query(
      `INSERT INTO platform.organizations (
         organization_id, tenant_id, name
       ) VALUES (
         $1::uuid, $2::uuid, 'Learning AI Integration Organization'
       )`,
      [organizationId, tenantId],
    );
    await client.query(
      `INSERT INTO platform.memberships (
         tenant_id, organization_id, subject_id, actor_kind, issuer, status
       ) VALUES (
         $1::uuid, $2::uuid, $3, 'user', $4, 'ACTIVE'
       )`,
      [tenantId, organizationId, learnerSubjectId, learnerIssuer],
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
    const storageCapabilities = await client.query<{
      capability_id: string;
      capability_key: string;
    }>(
      `INSERT INTO platform.capabilities (
         capability_key, display_name, permitted_modes, enabled
       ) VALUES
         ('storage.store', 'Storage Store', ARRAY['A']::text[], true),
         ('storage.read', 'Storage Read', ARRAY['A']::text[], true)
       ON CONFLICT (capability_key)
       DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING capability_id, capability_key`,
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

    const storageConnector = await client.query<{
      connector_id: string;
    }>(
      `INSERT INTO platform.connectors (
         connector_key, provider_type, provider_key, ownership_scope,
         tenant_id, region, residency_tags, compliance_tags,
         health, priority, enabled, fallback_enabled
       ) VALUES (
         $1, 'supabase-storage', 'supabase-storage', 'TENANT',
         $2::uuid, 'test-region', ARRAY[]::text[], ARRAY[]::text[],
         'HEALTHY', 1, true, false
       )
       RETURNING connector_id`,
      [storageConnectorKey, tenantId],
    );
    for (const capabilityRow of storageCapabilities.rows) {
      await client.query(
        `INSERT INTO platform.connector_capabilities (
           connector_id, capability_id
         ) VALUES ($1::uuid, $2::uuid)`,
        [
          storageConnector.rows[0]!.connector_id,
          capabilityRow.capability_id,
        ],
      );
    }
    await client.query(
      `INSERT INTO platform.connector_credentials (
         connector_id, credential_ref, key_version, custody_mode, state
       ) VALUES ($1::uuid, $2, 'v1', 'PLATFORM_MANAGED', 'ACTIVE')`,
      [storageConnector.rows[0]!.connector_id, storageCredentialRef],
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

    const replay = await tx(client, () =>
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
    assert.equal(replay.created, false);
    assert.equal(replay.request.jobId, request.request.jobId);
    assert.equal(
      replay.request.learningAiRequestId,
      request.request.learningAiRequestId,
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
            prompt: 'A different prompt must not reuse the same key.',
            idempotencyKey: 'tutor-precision-recall-1',
          }),
        ),
      /LEARNING_AI_IDEMPOTENCY_CONFLICT/,
    );

    const queuedAt = await client.query<{
      available_at: Date | string;
    }>(
      `SELECT available_at
         FROM platform.ai_job_execution_queue
        WHERE tenant_id = $1::uuid
          AND job_id = $2::uuid
        LIMIT 1`,
      [tenantId, request.request.jobId],
    );
    const availableAt = queuedAt.rows[0]?.available_at;
    assert.ok(availableAt);
    const workerNow = new Date(new Date(availableAt).getTime() + 1_000);

    let providerCalls = 0;
    let aiSecretReads = 0;
    let storageSecretReads = 0;
    let storageWrites = 0;
    let storageReads = 0;
    let bucketChecks = 0;

    const secretResolver = {
      async resolve(reference: string) {
        if (reference === credentialRef) {
          aiSecretReads += 1;
          return { value: 'sk-learning-ai-itest' };
        }
        if (reference === storageCredentialRef) {
          storageSecretReads += 1;
          return { value: 'storage-learning-ai-itest' };
        }
        assert.fail(`unexpected credential reference: ${reference}`);
      },
    };

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);

      if (url === 'https://api.openai.com/v1/chat/completions') {
        providerCalls += 1;
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
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      assert.equal(
        headers.get('Authorization'),
        'Bearer storage-learning-ai-itest',
      );
      const bucketUrl =
        `${storageProjectUrl}/storage/v1/bucket/${encodeURIComponent(storageBucket)}`;
      if (url === bucketUrl && (init?.method ?? 'GET') === 'GET') {
        bucketChecks += 1;
        return new Response(
          JSON.stringify({ id: storageBucket, public: false }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      const writePrefix =
        `${storageProjectUrl}/storage/v1/object/${encodeURIComponent(storageBucket)}/`;
      if (url.startsWith(writePrefix) && init?.method === 'POST') {
        storageWrites += 1;
        const path = url.slice(writePrefix.length);
        const body = init.body;
        const bytes =
          body instanceof Uint8Array
            ? body
            : typeof body === 'string'
              ? new TextEncoder().encode(body)
              : new Uint8Array(
                  await new Response(body as BodyInit | null).arrayBuffer(),
                );
        storedObjects.set(path, bytes);
        return new Response('', { status: 200 });
      }

      const readPrefix =
        `${storageProjectUrl}/storage/v1/object/authenticated/${encodeURIComponent(storageBucket)}/`;
      if (url.startsWith(readPrefix) && (init?.method ?? 'GET') === 'GET') {
        storageReads += 1;
        const path = url.slice(readPrefix.length);
        const bytes = storedObjects.get(path);
        if (bytes === undefined) {
          return new Response('not found', { status: 404 });
        }
        return new Response(bytes, {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        });
      }

      assert.fail(`unexpected fetch URL: ${url}`);
    };

    const worker = await runAiJobWorkerOnce(client, {
      tenantId,
      options: {
        serviceSubjectId,
        now: () => workerNow,
        secretResolver,
        fetchImpl,
        artifactStorage: {
          projectUrl: storageProjectUrl,
          bucket: storageBucket,
        },
      },
    });

    assert.equal(worker.status, 'SUCCEEDED');
    if (worker.status !== 'SUCCEEDED') {
      throw new Error('expected successful AI worker result');
    }
    assert.equal(worker.connectorKey, connectorKey);
    assert.equal(providerCalls, 1);
    assert.equal(aiSecretReads, 1);
    assert.equal(storageSecretReads, 1);
    assert.equal(storageWrites, 1);
    assert.equal(storageReads, 0);
    assert.equal(bucketChecks, 1);
    assert.match(worker.outputReference, /^supabase-storage:\/\//);

    const outputResolver = async (input: {
      readonly jobId: string;
      readonly reference: string;
    }) => {
      const artifact = await findExecutionArtifactBySource(client, {
        tenantId,
        artifactKind: 'AI_TEXT',
        sourceKind: 'AI_INVOCATION',
        sourceId: `ai-job:${input.jobId}`,
      });
      assert.ok(artifact);
      assert.equal(artifact.storageReference, input.reference);

      const store = await createGovernedSupabaseArtifactStore(client, {
        tenantId,
        organizationId:
          '00000000-0000-0000-0000-000000000000',
        serviceSubjectId,
        correlationId: request.request.correlationId,
        projectUrl: storageProjectUrl,
        bucket: storageBucket,
        requiredResidencyTags: [],
        requiredComplianceTags: [],
        secretResolver,
        fetchImpl,
        now: () => workerNow,
      });
      const resolved = await store.readText({
        tenantId,
        reference: input.reference,
        purpose: `learning.ai.output:${input.jobId}`,
        requiredResidencyTags: [],
        requiredComplianceTags: [],
      });
      return {
        mediaType: artifact.mediaType,
        content: resolved.content,
      };
    };

    const status = await tx(client, () =>
      loadLearningAiRequestStatus(client, {
        tenantId,
        learningAiRequestId: request.request.learningAiRequestId,
        actorSubjectId: learnerSubjectId,
        actorIssuer: learnerIssuer,
        outputResolver,
      }),
    );
    assert.equal(status.jobStatus, 'SUCCEEDED');
    assert.equal(
      status.output?.content,
      'Recall measures relevant items found; precision measures how many found items are relevant.',
    );
    assert.equal(status.confidence, 0.95);
    assert.equal(status.costMinorUnits, 1);
    assert.equal(storageSecretReads, 2);
    assert.equal(storageReads, 1);
    assert.equal(bucketChecks, 2);

    const evidence = await client.query<{
      input_reference: string;
      job_output_artifacts: number;
      execution_artifacts: number;
      storage_reference: string;
      capability_key: string;
      artifact_cost_minor_units: number;
      provider_cost_ownership: string;
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
             AND artifact_type = 'OUTPUT') AS job_output_artifacts,
         (SELECT count(*)::int FROM platform.execution_artifacts
           WHERE tenant_id = $1::uuid
             AND source_kind = 'AI_INVOCATION'
             AND source_id = $3) AS execution_artifacts,
         (SELECT storage_reference FROM platform.execution_artifacts
           WHERE tenant_id = $1::uuid
             AND source_kind = 'AI_INVOCATION'
             AND source_id = $3) AS storage_reference,
         (SELECT capability_key FROM platform.execution_artifacts
           WHERE tenant_id = $1::uuid
             AND source_kind = 'AI_INVOCATION'
             AND source_id = $3) AS capability_key,
         (SELECT cost_minor_units::int FROM platform.execution_artifacts
           WHERE tenant_id = $1::uuid
             AND source_kind = 'AI_INVOCATION'
             AND source_id = $3) AS artifact_cost_minor_units,
         (SELECT provider_cost_ownership FROM platform.execution_artifacts
           WHERE tenant_id = $1::uuid
             AND source_kind = 'AI_INVOCATION'
             AND source_id = $3) AS provider_cost_ownership,
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
    assert.equal(evidence.rows[0]!.job_output_artifacts, 0);
    assert.equal(evidence.rows[0]!.execution_artifacts, 1);
    assert.equal(
      evidence.rows[0]!.storage_reference,
      worker.outputReference,
    );
    assert.equal(evidence.rows[0]!.capability_key, 'ai.generate');
    assert.equal(evidence.rows[0]!.artifact_cost_minor_units, 1);
    assert.equal(evidence.rows[0]!.provider_cost_ownership, 'BYOK');
    assert.equal(evidence.rows[0]!.started_events, 1);
    assert.equal(evidence.rows[0]!.succeeded_events, 1);
    assert.equal(evidence.rows[0]!.usage_events, 1);
    assert.equal(evidence.rows[0]!.completed_queue_rows, 1);
    assert.equal(evidence.rows[0]!.credential_lease_events, 3);

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
        outputResolver,
      }),
    );
    assert.equal(historical.jobStatus, 'SUCCEEDED');
    assert.equal(historical.output?.content, status.output?.content);
    assert.equal(storageSecretReads, 3);
    assert.equal(storageReads, 2);
    assert.equal(bucketChecks, 3);
  } finally {
    client.release();
    await db.end();
  }
});
