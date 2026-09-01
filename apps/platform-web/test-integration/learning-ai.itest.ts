import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  createLearningAiRequest,
  loadLearningAiRequestStatus,
  updateLearningAiSettings,
} from '@expadio/postgres-runtime/learning-ai';
import { activateLearningModule } from '@expadio/postgres-runtime/product-module';
import {
  aiArtifactReference,
  createAiJobArtifact,
} from '@expadio/postgres-runtime/ai-artifact';
import { PostgresAiJobRepository } from '@expadio/postgres-runtime/ai-job';

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

async function provisionLearningTenant(
  client: pg.PoolClient,
  tenantId: string,
  name: string,
): Promise<void> {
  await client.query(
    `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
     VALUES ($1::uuid, $2, 'dentex')`,
    [tenantId, name],
  );
  await client.query(
    `INSERT INTO platform.tenant_module_entitlements
       (tenant_id, module_key, source_type, source_key, status)
     VALUES ($1::uuid, 'learning', 'PLAN', 'itest-enterprise', 'ACTIVE')`,
    [tenantId],
  );
  await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
  await client.query('BEGIN');
  await activateLearningModule(client, {
    tenantId,
    actorSubjectId: 'learning-admin',
    correlationId: randomUUID(),
  });
  await client.query('COMMIT');
}

test('Learning AI enablement, idempotency, historical status, and tenant isolation are durable', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const learnerSubject = 'learning-ai-learner';
    const learnerIssuer = 'itest';

    await provisionLearningTenant(c, tenantA, 'Learning AI tenant A');

    await c.query(
      `INSERT INTO platform.learning_learners (
         tenant_id, subject_id, subject_issuer, full_name, audience_type,
         created_by_subject_id
       ) VALUES ($1::uuid, $2, $3, 'AI Learner', 'INTERNAL', 'learning-admin')`,
      [tenantA, learnerSubject, learnerIssuer],
    );

    await updateLearningAiSettings(c, {
      tenantId: tenantA,
      aiFeaturesEnabled: true,
    });

    const idempotencyKey = 'tutor-request-1';
    const first = await createLearningAiRequest(c, {
      tenantId: tenantA,
      actorSubjectId: learnerSubject,
      actorIssuer: learnerIssuer,
      correlationId: randomUUID(),
      requestType: 'TUTOR',
      prompt: 'Explain the approved course concept in simple terms.',
      idempotencyKey,
    });
    assert.equal(first.created, true);

    const replay = await createLearningAiRequest(c, {
      tenantId: tenantA,
      actorSubjectId: learnerSubject,
      actorIssuer: learnerIssuer,
      correlationId: randomUUID(),
      requestType: 'TUTOR',
      prompt: 'Explain the approved course concept in simple terms.',
      idempotencyKey,
    });
    assert.equal(replay.created, false);
    assert.equal(replay.request.jobId, first.request.jobId);
    assert.equal(
      replay.request.learningAiRequestId,
      first.request.learningAiRequestId,
    );

    const queued = await loadLearningAiRequestStatus(c, {
      tenantId: tenantA,
      learningAiRequestId: first.request.learningAiRequestId,
      actorSubjectId: learnerSubject,
      actorIssuer: learnerIssuer,
    });
    assert.equal(queued.jobStatus, 'QUEUED');
    assert.equal(queued.output, null);

    const output = await createAiJobArtifact(c, {
      tenantId: tenantA,
      jobId: first.request.jobId,
      artifactType: 'OUTPUT',
      content: 'Grounded tutor response.',
      createdBySubjectId: 'ai-worker',
    });
    const repository = new PostgresAiJobRepository(c);
    const startedAt = new Date().toISOString();
    const started = await repository.appendEvent({
      eventId: randomUUID(),
      jobId: first.request.jobId,
      tenantId: tenantA,
      sequence: 1,
      type: 'STARTED',
      occurredAt: startedAt,
      actorSubjectId: 'ai-worker',
      reason: 'Bounded worker started Learning AI execution.',
      correlationId: first.request.correlationId,
      evidenceRefs: [],
    });
    assert.equal(started.status, 'COMMITTED');

    const succeeded = await repository.appendEvent({
      eventId: randomUUID(),
      jobId: first.request.jobId,
      tenantId: tenantA,
      sequence: 2,
      type: 'SUCCEEDED',
      occurredAt: new Date().toISOString(),
      actorSubjectId: 'ai-worker',
      reason: 'Bounded worker completed Learning AI execution.',
      correlationId: first.request.correlationId,
      evidenceRefs: [],
      outputReference: aiArtifactReference(output.artifactId),
      confidence: 0.9,
      costMinorUnits: 7,
    });
    assert.equal(succeeded.status, 'COMMITTED');

    const completed = await loadLearningAiRequestStatus(c, {
      tenantId: tenantA,
      learningAiRequestId: first.request.learningAiRequestId,
      actorSubjectId: learnerSubject,
      actorIssuer: learnerIssuer,
    });
    assert.equal(completed.jobStatus, 'SUCCEEDED');
    assert.equal(completed.output?.content, 'Grounded tutor response.');
    assert.equal(completed.costMinorUnits, 7);

    await updateLearningAiSettings(c, {
      tenantId: tenantA,
      aiFeaturesEnabled: false,
    });

    await assert.rejects(
      () =>
        createLearningAiRequest(c, {
          tenantId: tenantA,
          actorSubjectId: learnerSubject,
          actorIssuer: learnerIssuer,
          correlationId: randomUUID(),
          requestType: 'TUTOR',
          prompt: 'This new request must be denied after disable.',
          idempotencyKey: 'tutor-request-after-disable',
        }),
      /LEARNING_AI_FEATURES_DISABLED/,
    );

    const historical = await loadLearningAiRequestStatus(c, {
      tenantId: tenantA,
      learningAiRequestId: first.request.learningAiRequestId,
      actorSubjectId: learnerSubject,
      actorIssuer: learnerIssuer,
    });
    assert.equal(historical.jobStatus, 'SUCCEEDED');
    assert.equal(historical.output?.content, 'Grounded tutor response.');

    await provisionLearningTenant(c, tenantB, 'Learning AI tenant B');

    await assert.rejects(
      () =>
        loadLearningAiRequestStatus(c, {
          tenantId: tenantA,
          learningAiRequestId: first.request.learningAiRequestId,
          actorSubjectId: learnerSubject,
          actorIssuer: learnerIssuer,
        }),
      /MODULE_|LEARNING_AI_REQUEST_NOT_FOUND|TENANT/,
    );

    const hidden = await c.query(
      `SELECT count(*)::int AS count
         FROM platform.learning_ai_requests
        WHERE tenant_id = $1::uuid
          AND learning_ai_request_id = $2::uuid`,
      [tenantA, first.request.learningAiRequestId],
    );
    assert.equal(hidden.rows[0]?.count, 0);
  } finally {
    c.release();
    await p.end();
  }
});
