import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  appendDomainEventWithOutbox,
} from '@expadio/postgres-runtime/domain-events';
import {
  persistGovernedActionIntent,
} from '@expadio/postgres-runtime/governed-action-intent';
import type {
  DurableArtifactProviderFetchResult,
  DurableArtifactReadContext,
  DurableArtifactSink,
  DurableArtifactSource,
  DurableArtifactWriteInput,
  DurableArtifactWriteResult,
} from '@expadio/storage';
import {
  executePersistedGovernedAiAction,
} from '../lib/governed-ai-executor.ts';

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

class MemoryArtifactStore
implements DurableArtifactSink, DurableArtifactSource {
  readonly #objects = new Map<string, Uint8Array>();

  seed(reference: string, content: string): void {
    this.#objects.set(reference, new TextEncoder().encode(content));
  }

  async write(
    input: DurableArtifactWriteInput,
  ): Promise<DurableArtifactWriteResult> {
    const bytes = typeof input.content === 'string'
      ? new TextEncoder().encode(input.content)
      : input.content;
    const reference =
      `memory://${input.tenantId}/${input.artifactKind}/${input.sourceId}`;
    this.#objects.set(reference, bytes);
    return {
      contentReference: reference,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.byteLength,
    };
  }

  async readText(input: DurableArtifactReadContext) {
    const bytes = this.#objects.get(input.reference);
    if (bytes === undefined) {
      throw new Error('MEMORY_ARTIFACT_NOT_FOUND');
    }
    return {
      content: new TextDecoder().decode(bytes),
      contentReference: input.reference,
    };
  }

  async issueProviderFetchUrl(
    _input: DurableArtifactReadContext,
  ): Promise<DurableArtifactProviderFetchResult> {
    throw new Error('AI_E2E_PROVIDER_FETCH_URL_NOT_USED');
  }
}

test('governed AI execution persists credential lease, output artifact, review-only attempt, and replay', async () => {
  const db = pool();
  const client = await db.connect();
  const tenantId = randomUUID();
  const organizationId = randomUUID();
  const eventId = randomUUID();
  const aggregateId = randomUUID();
  const serviceSubjectId = `ai-runtime-${randomUUID()}`;
  const roleKey = `ai-runtime-role-${randomUUID()}`;
  const connectorKey = `openai-${randomUUID()}`;
  const credentialRef = `vault://tenant/${tenantId}/connector/${connectorKey}/v1`;
  const correlationId = randomUUID();
  const inputReference = `memory://${tenantId}/clinical-note/input-1`;
  const staticNow = new Date('2026-08-31T03:30:00.000Z');
  const store = new MemoryArtifactStore();
  store.seed(
    inputReference,
    'Patient presented with fractured cusp on tooth #19. D2740 discussed.',
  );
  let providerCalls = 0;
  let secretReads = 0;

  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO platform.tenants (tenant_id, name)
       VALUES ($1::uuid, 'Governed AI E2E tenant')`,
      [tenantId],
    );
    await client.query(
      `INSERT INTO platform.organizations (
         organization_id, tenant_id, organization_kind, name, status
       ) VALUES (
         $1::uuid, $2::uuid, 'BUSINESS', 'Governed AI E2E org', 'ACTIVE'
       )`,
      [organizationId, tenantId],
    );
    await client.query(
      `SELECT set_config('app.tenant_id', $1, true)`,
      [tenantId],
    );
    await client.query(
      `SELECT set_config('app.organization_id', $1, true)`,
      [organizationId],
    );
    await client.query(
      `SELECT set_config('app.subject_id', $1, true)`,
      [serviceSubjectId],
    );

    const roleId = (await client.query(
      `INSERT INTO platform.authorization_roles (
         role_key, display_name, ownership_scope, tenant_id, status
       ) VALUES (
         $1, 'Governed AI runtime', 'TENANT', $2::uuid, 'ACTIVE'
       )
       RETURNING role_id`,
      [roleKey, tenantId],
    )).rows[0].role_id as string;

    await client.query(
      `INSERT INTO platform.authorization_role_capabilities (
         role_id, action, resource_type
       ) VALUES (
         $1::uuid, 'credential.lease', 'connector-credential'
       )`,
      [roleId],
    );
    await client.query(
      `INSERT INTO platform.authorization_assignments (
         tenant_id, organization_id, subject_id, role_id, status,
         action_organization_ids, clearances, sensitive_compartments
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4::uuid, 'ACTIVE',
         ARRAY[$2::uuid], ARRAY['sensitive']::text[],
         ARRAY['provider-credentials']::text[]
       )`,
      [tenantId, organizationId, serviceSubjectId, roleId],
    );

    const capabilityId = (await client.query(
      `INSERT INTO platform.capabilities (
         capability_key, display_name, permitted_modes, enabled
       ) VALUES (
         'ai.extract', 'AI Extract', ARRAY['A']::text[], true
       )
       ON CONFLICT (capability_key) DO UPDATE
       SET display_name = EXCLUDED.display_name
       RETURNING capability_id`,
    )).rows[0].capability_id as string;

    const connectorId = (await client.query(
      `INSERT INTO platform.connectors (
         connector_key, provider_type, provider_key, ownership_scope, tenant_id,
         region, residency_tags, compliance_tags, health, priority,
         enabled, fallback_enabled
       ) VALUES (
         $1, 'openai', 'openai', 'TENANT', $2::uuid,
         'us-east-1', ARRAY['US']::text[], ARRAY['SOC2']::text[],
         'HEALTHY', 1, true, false
       )
       RETURNING connector_id`,
      [connectorKey, tenantId],
    )).rows[0].connector_id as string;

    await client.query(
      `INSERT INTO platform.connector_capabilities (
         connector_id, capability_id
       ) VALUES ($1::uuid, $2::uuid)`,
      [connectorId, capabilityId],
    );
    await client.query(
      `INSERT INTO platform.connector_credentials (
         connector_id, credential_ref, key_version, custody_mode, state
       ) VALUES (
         $1::uuid, $2, 'v1', 'PLATFORM_MANAGED', 'ACTIVE'
       )`,
      [connectorId, credentialRef],
    );

    await appendDomainEventWithOutbox(client, {
      event: {
        eventId,
        tenantId,
        aggregateType: 'crm.case',
        aggregateId,
        eventType: 'Consultation.Completed',
        eventVersion: 1,
        occurredAt: new Date('2026-08-31T03:29:58.000Z'),
        actorSubjectId: 'dentist-reviewer',
        correlationId,
        causationId: 'consultation-complete',
        packKey: 'dentex',
        payload: {
          patientId: aggregateId,
          consultationReference: inputReference,
        },
      },
    });

    const action = await persistGovernedActionIntent(client, {
      tenantId,
      sourceEventId: eventId,
      sourceEventType: 'Consultation.Completed',
      aggregateType: 'crm.case',
      aggregateId,
      ruleKey: 'dentex.consultation.ai.extract',
      executorClass: 'AI_ACTION',
      actionKey: 'clinical.extract',
      idempotencyKey: `ai-extract:${eventId}`,
      correlationId,
      causationId: eventId,
      requestedBySubjectId: 'dentist-reviewer',
      requestedAt: new Date('2026-08-31T03:29:59.000Z'),
      configuration: {
        operation: 'EXTRACT',
        purpose: 'Extract explicit clinical identifiers for clinician review',
        inputReference,
        promptKey: 'prompt.dentex.clinical_extraction',
        promptVersion: 1,
        requiredResidencyTags: ['US'],
        requiredComplianceTags: ['SOC2'],
      },
      policyDecision: {
        allowed: true,
        policyKeys: ['policy.ai.review-required'],
        evidenceRefs: ['consultation:completed'],
        reasonCode: 'POLICY_ALLOWED',
        evaluatedAt: new Date('2026-08-31T03:29:59.000Z'),
      },
    });

    const result = await executePersistedGovernedAiAction(client, {
      intent: action,
      options: {
        serviceSubjectId,
        organizationId,
        artifactBlobSink: store,
        artifactSource: store,
        secretResolver: {
          resolve: async (reference) => {
            secretReads += 1;
            assert.equal(reference, credentialRef);
            return { value: 'openai-test-token' };
          },
        },
        fetchImpl: async (resource, init) => {
          providerCalls += 1;
          assert.equal(
            String(resource),
            'https://api.openai.com/v1/chat/completions',
          );
          const headers = new Headers(init?.headers);
          assert.equal(
            headers.get('Authorization'),
            'Bearer openai-test-token',
          );
          const body = JSON.parse(String(init?.body)) as {
            model: string;
            messages: Array<{ role: string; content: string }>;
          };
          assert.equal(body.model, 'gpt-4o-mini');
          assert.equal(
            body.messages.at(-1)?.content,
            'Patient presented with fractured cusp on tooth #19. D2740 discussed.',
          );
          return new Response(JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  tooth: '19',
                  procedureCode: 'D2740',
                }),
              },
              finish_reason: 'stop',
            }],
            usage: {
              prompt_tokens: 18,
              completion_tokens: 9,
              total_tokens: 27,
            },
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
        now: () => staticNow,
      },
    });

    assert.equal(providerCalls, 1);
    assert.equal(secretReads, 1);
    assert.equal(result.replayed, false);
    assert.equal(result.approved, false);
    assert.equal(result.attempt.status, 'SUCCEEDED');
    assert.equal(result.attempt.reasonCode, 'AI_PROPOSAL_REQUIRES_REVIEW');
    assert.equal(result.attempt.metadata.approved, false);
    assert.ok(result.proposalOutputReference?.startsWith(
      `memory://${tenantId}/AI_TEXT/`,
    ));

    const artifacts = await client.query(
      `SELECT artifact_kind, source_kind, source_id, storage_reference,
              content_sha256, provider_key, connector_key, model_key,
              correlation_id
         FROM platform.execution_artifacts
        WHERE tenant_id = $1::uuid
          AND source_kind = 'AI_INVOCATION'`,
      [tenantId],
    );
    assert.equal(artifacts.rowCount, 1);
    assert.equal(artifacts.rows[0].artifact_kind, 'AI_TEXT');
    assert.equal(
      artifacts.rows[0].source_id,
      `inv_${action.idempotencyKey}`,
    );
    assert.equal(artifacts.rows[0].provider_key, 'openai');
    assert.equal(artifacts.rows[0].connector_key, connectorKey);
    assert.equal(artifacts.rows[0].model_key, 'gpt-4o-mini');
    assert.equal(artifacts.rows[0].correlation_id, correlationId);
    assert.match(artifacts.rows[0].content_sha256, /^[a-f0-9]{64}$/);

    const leases = await client.query(
      `SELECT connector_key, outcome, authorization_reason_key,
              credential_reference, correlation_id
         FROM platform.credential_lease_events
        WHERE tenant_id = $1::uuid`,
      [tenantId],
    );
    assert.equal(leases.rowCount, 1);
    assert.equal(leases.rows[0].connector_key, connectorKey);
    assert.equal(leases.rows[0].outcome, 'ISSUED');
    assert.equal(leases.rows[0].authorization_reason_key, 'GRANTED');
    assert.equal(leases.rows[0].credential_reference, credentialRef);
    assert.equal(leases.rows[0].correlation_id, correlationId);

    const attempts = await client.query(
      `SELECT status, reason_code, output_reference, metadata
         FROM platform.governed_action_execution_attempts
        WHERE tenant_id = $1::uuid
          AND action_intent_id = $2::uuid`,
      [tenantId, action.actionIntentId],
    );
    assert.equal(attempts.rowCount, 1);
    assert.equal(attempts.rows[0].status, 'SUCCEEDED');
    assert.equal(
      attempts.rows[0].reason_code,
      'AI_PROPOSAL_REQUIRES_REVIEW',
    );
    assert.equal(attempts.rows[0].metadata.approved, false);

    const replay = await executePersistedGovernedAiAction(client, {
      intent: action,
      options: {
        serviceSubjectId,
        organizationId,
        artifactBlobSink: store,
        artifactSource: store,
        secretResolver: {
          resolve: async () => assert.fail('replay must not resolve secrets'),
        },
        fetchImpl: async () => assert.fail('replay must not call provider'),
        now: () => staticNow,
      },
    });

    assert.equal(replay.replayed, true);
    assert.equal(replay.approved, false);
    assert.equal(providerCalls, 1);
    assert.equal(secretReads, 1);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await db.end();
  }
});
