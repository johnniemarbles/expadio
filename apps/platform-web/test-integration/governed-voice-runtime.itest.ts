import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import type {
  DurableArtifactReadContext,
  DurableArtifactSink,
  DurableArtifactSource,
  DurableArtifactWriteInput,
  DurableArtifactWriteResult,
} from '@expadio/storage';
import {
  invokeGovernedVoiceIntelligence,
} from '../lib/governed-voice-runtime.ts';

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

class MemoryVoiceArtifactStore
implements DurableArtifactSink, DurableArtifactSource {
  readonly #text = new Map<string, string>();
  readonly #objects = new Map<string, Uint8Array>();

  seedText(reference: string, content: string): void {
    this.#text.set(reference, content);
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
    const content = this.#text.get(input.reference);
    if (content === undefined) throw new Error('MEMORY_VOICE_TEXT_NOT_FOUND');
    return {
      content,
      contentReference: input.reference,
    };
  }

  async issueProviderFetchUrl(input: DurableArtifactReadContext) {
    return {
      providerFetchUrl:
        `https://signed.example.test/audio.wav?source=${encodeURIComponent(input.reference)}`,
      contentReference: input.reference,
      expiresAt: '2026-08-31T03:45:00.000Z',
    };
  }
}

async function capabilityId(
  client: pg.PoolClient,
  key: string,
  displayName: string,
): Promise<string> {
  return (await client.query(
    `INSERT INTO platform.capabilities (
       capability_key, display_name, permitted_modes, enabled
     ) VALUES ($1, $2, ARRAY['A']::text[], true)
     ON CONFLICT (capability_key) DO UPDATE
     SET display_name = EXCLUDED.display_name
     RETURNING capability_id`,
    [key, displayName],
  )).rows[0].capability_id as string;
}

async function connector(
  client: pg.PoolClient,
  input: {
    tenantId: string;
    connectorKey: string;
    provider: string;
    capabilityId: string;
    credentialRef: string;
  },
): Promise<void> {
  const connectorId = (await client.query(
    `INSERT INTO platform.connectors (
       connector_key, provider_type, provider_key, ownership_scope, tenant_id,
       region, residency_tags, compliance_tags, health, priority,
       enabled, fallback_enabled
     ) VALUES (
       $1, $2, $2, 'TENANT', $3::uuid,
       'us-east-1', ARRAY['US']::text[], ARRAY['SOC2']::text[],
       'HEALTHY', 1, true, false
     )
     RETURNING connector_id`,
    [input.connectorKey, input.provider, input.tenantId],
  )).rows[0].connector_id as string;

  await client.query(
    `INSERT INTO platform.connector_capabilities (
       connector_id, capability_id
     ) VALUES ($1::uuid, $2::uuid)`,
    [connectorId, input.capabilityId],
  );
  await client.query(
    `INSERT INTO platform.connector_credentials (
       connector_id, credential_ref, key_version, custody_mode, state
     ) VALUES (
       $1::uuid, $2, 'v1', 'PLATFORM_MANAGED', 'ACTIVE'
     )`,
    [connectorId, input.credentialRef],
  );
}

test('governed Voice STT/TTS persist lease and artifact evidence without autonomous transport', async () => {
  const db = pool();
  const client = await db.connect();
  const tenantId = randomUUID();
  const organizationId = randomUUID();
  const serviceSubjectId = `voice-runtime-${randomUUID()}`;
  const roleKey = `voice-runtime-role-${randomUUID()}`;
  const deepgramConnectorKey = `deepgram-${randomUUID()}`;
  const elevenLabsConnectorKey = `elevenlabs-${randomUUID()}`;
  const deepgramCredentialRef =
    `vault://tenant/${tenantId}/connector/${deepgramConnectorKey}/v1`;
  const elevenLabsCredentialRef =
    `vault://tenant/${tenantId}/connector/${elevenLabsConnectorKey}/v1`;
  const sttCorrelationId = randomUUID();
  const ttsCorrelationId = randomUUID();
  const callId = randomUUID();
  const audioReference = `artifact://voice-recording/${callId}`;
  const ttsInputReference = `artifact://voice-text/${callId}`;
  const staticNow = new Date('2026-08-31T03:30:00.000Z');
  const store = new MemoryVoiceArtifactStore();
  store.seedText(
    ttsInputReference,
    'Your follow-up appointment is confirmed for tomorrow.',
  );

  let deepgramCalls = 0;
  let elevenLabsCalls = 0;
  const resolvedCredentials: string[] = [];

  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO platform.tenants (tenant_id, name)
       VALUES ($1::uuid, 'Governed Voice E2E tenant')`,
      [tenantId],
    );
    await client.query(
      `INSERT INTO platform.organizations (
         organization_id, tenant_id, organization_kind, name, status
       ) VALUES (
         $1::uuid, $2::uuid, 'BUSINESS', 'Governed Voice E2E org', 'ACTIVE'
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
         $1, 'Governed Voice runtime', 'TENANT', $2::uuid, 'ACTIVE'
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

    const transcribeCapabilityId = await capabilityId(
      client,
      'voice.transcribe',
      'Voice Transcribe',
    );
    const synthesizeCapabilityId = await capabilityId(
      client,
      'voice.synthesize',
      'Voice Synthesize',
    );

    await connector(client, {
      tenantId,
      connectorKey: deepgramConnectorKey,
      provider: 'deepgram',
      capabilityId: transcribeCapabilityId,
      credentialRef: deepgramCredentialRef,
    });
    await connector(client, {
      tenantId,
      connectorKey: elevenLabsConnectorKey,
      provider: 'elevenlabs',
      capabilityId: synthesizeCapabilityId,
      credentialRef: elevenLabsCredentialRef,
    });

    const secretResolver = {
      resolve: async (reference: string) => {
        resolvedCredentials.push(reference);
        if (reference === deepgramCredentialRef) {
          return { value: 'deepgram-test-token' };
        }
        if (reference === elevenLabsCredentialRef) {
          return { value: 'elevenlabs-test-token' };
        }
        return assert.fail(`unexpected credential reference: ${reference}`);
      },
    };

    const baseGovernance = {
      recordingRetentionPolicy: {
        key: 'policy.voice.recording-retention',
        version: 1,
      },
      transcriptRetentionPolicy: {
        key: 'policy.voice.transcript-retention',
        version: 1,
      },
      redactionPolicy: {
        key: 'policy.voice.redaction',
        version: 1,
      },
      jurisdictionTags: ['US-CA'],
      requiredResidencyTags: ['US'],
      requiredComplianceTags: ['SOC2'],
    } as const;

    const stt = await invokeGovernedVoiceIntelligence(client, {
      intent: {
        requestId: randomUUID(),
        tenantId,
        callId,
        operation: 'TRANSCRIBE',
        purpose: 'Transcribe governed patient consultation recording',
        inputReference: audioReference,
        languageTag: 'en-US',
        governance: {
          ...baseGovernance,
          recordingConsentEvidenceReference: 'consent://voice/stt-1',
          callerDisclosureEvidenceReference: 'disclosure://voice/stt-1',
          maximumCostMinorUnits: 10,
        },
        idempotencyKey: `voice:stt:${callId}`,
        correlationId: sttCorrelationId,
        requestedAt: '2026-08-31T03:29:59.000Z',
      },
      options: {
        serviceSubjectId,
        organizationId,
        artifactBlobSink: store,
        artifactSource: store,
        secretResolver,
        fetchImpl: async (resource, init) => {
          deepgramCalls += 1;
          assert.match(
            String(resource),
            /^https:\/\/api\.deepgram\.com\/v1\/listen\?/,
          );
          const headers = new Headers(init?.headers);
          assert.equal(
            headers.get('Authorization'),
            'Token deepgram-test-token',
          );
          const body = JSON.parse(String(init?.body)) as { url: string };
          assert.match(body.url, /^https:\/\/signed\.example\.test\//);
          assert.ok(body.url.includes(encodeURIComponent(audioReference)));

          return new Response(JSON.stringify({
            results: {
              channels: [{
                alternatives: [{
                  transcript: 'Patient reports sensitivity on tooth nineteen.',
                  confidence: 0.97,
                }],
              }],
            },
            metadata: { duration: 42 },
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
        now: () => staticNow,
      },
    });

    assert.equal(stt.operation, 'TRANSCRIBE');
    assert.equal(stt.provenance.connectorKey, deepgramConnectorKey);
    assert.equal(stt.provenance.audioDurationMilliseconds, 42000);
    assert.ok(stt.outputReference.startsWith(
      `memory://${tenantId}/VOICE_TRANSCRIPT/`,
    ));

    const tts = await invokeGovernedVoiceIntelligence(client, {
      intent: {
        requestId: randomUUID(),
        tenantId,
        callId,
        operation: 'SYNTHESIZE',
        purpose: 'Synthesize governed appointment follow-up message',
        inputReference: ttsInputReference,
        languageTag: 'en-US',
        governance: {
          ...baseGovernance,
          callerDisclosureEvidenceReference: 'disclosure://voice/tts-1',
        },
        idempotencyKey: `voice:tts:${callId}`,
        correlationId: ttsCorrelationId,
        requestedAt: '2026-08-31T03:30:01.000Z',
      },
      options: {
        serviceSubjectId,
        organizationId,
        artifactBlobSink: store,
        artifactSource: store,
        secretResolver,
        fetchImpl: async (resource, init) => {
          elevenLabsCalls += 1;
          assert.match(
            String(resource),
            /^https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\//,
          );
          const headers = new Headers(init?.headers);
          assert.equal(
            headers.get('xi-api-key'),
            'elevenlabs-test-token',
          );
          const body = JSON.parse(String(init?.body)) as {
            text: string;
            model_id: string;
          };
          assert.equal(
            body.text,
            'Your follow-up appointment is confirmed for tomorrow.',
          );
          assert.equal(body.model_id, 'eleven_multilingual_v2');

          return new Response(
            new TextEncoder().encode('FAKE_GOVERNED_MP3'),
            {
              status: 200,
              headers: { 'Content-Type': 'audio/mpeg' },
            },
          );
        },
        now: () => staticNow,
      },
    });

    assert.equal(tts.operation, 'SYNTHESIZE');
    assert.equal(tts.provenance.connectorKey, elevenLabsConnectorKey);
    assert.ok(tts.outputReference.startsWith(
      `memory://${tenantId}/VOICE_AUDIO/`,
    ));
    assert.equal(deepgramCalls, 1);
    assert.equal(elevenLabsCalls, 1);
    assert.deepEqual(
      new Set(resolvedCredentials),
      new Set([deepgramCredentialRef, elevenLabsCredentialRef]),
    );

    const artifacts = await client.query(
      `SELECT artifact_kind, source_kind, provider_key, connector_key,
              model_key, correlation_id, content_sha256, byte_length
         FROM platform.execution_artifacts
        WHERE tenant_id = $1::uuid
          AND source_kind = 'VOICE_REQUEST'
        ORDER BY artifact_kind`,
      [tenantId],
    );
    assert.equal(artifacts.rowCount, 2);

    const audio = artifacts.rows.find(
      (row) => row.artifact_kind === 'VOICE_AUDIO',
    );
    const transcript = artifacts.rows.find(
      (row) => row.artifact_kind === 'VOICE_TRANSCRIPT',
    );
    assert.ok(audio);
    assert.ok(transcript);
    assert.equal(audio.connector_key, elevenLabsConnectorKey);
    assert.equal(audio.provider_key, 'elevenlabs');
    assert.equal(audio.model_key, 'eleven_multilingual_v2');
    assert.equal(audio.correlation_id, ttsCorrelationId);
    assert.ok(Number(audio.byte_length) > 0);
    assert.match(audio.content_sha256, /^[a-f0-9]{64}$/);

    assert.equal(transcript.connector_key, deepgramConnectorKey);
    assert.equal(transcript.provider_key, 'deepgram');
    assert.equal(transcript.model_key, 'nova-2');
    assert.equal(transcript.correlation_id, sttCorrelationId);
    assert.ok(Number(transcript.byte_length) > 0);
    assert.match(transcript.content_sha256, /^[a-f0-9]{64}$/);

    const leases = await client.query(
      `SELECT connector_key, outcome, authorization_reason_key,
              credential_reference, correlation_id
         FROM platform.credential_lease_events
        WHERE tenant_id = $1::uuid
        ORDER BY connector_key`,
      [tenantId],
    );
    assert.equal(leases.rowCount, 2);
    assert.deepEqual(
      new Set(leases.rows.map((row) => row.connector_key)),
      new Set([deepgramConnectorKey, elevenLabsConnectorKey]),
    );
    assert.equal(
      leases.rows.every((row) =>
        row.outcome === 'ISSUED'
        && row.authorization_reason_key === 'GRANTED'
      ),
      true,
    );
    assert.deepEqual(
      new Set(leases.rows.map((row) => row.correlation_id)),
      new Set([sttCorrelationId, ttsCorrelationId]),
    );
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await db.end();
  }
});
