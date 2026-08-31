import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SupabaseDurableArtifactStore,
  type DurableArtifactWriteInput,
} from '../src/index.ts';

const input: DurableArtifactWriteInput = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  artifactKind: 'AI_TEXT',
  sourceKind: 'AI_INVOCATION',
  sourceId: 'inv_123',
  content: 'hello world',
  contentType: 'text/plain; charset=utf-8',
  providerKey: 'openai',
  connectorKey: 'connector.ai.openai.us',
  modelKey: 'gpt-4o-mini',
  correlationId: 'corr-123',
  requiredResidencyTags: ['US'],
  requiredComplianceTags: ['SOC2'],
};

function store(fetchImpl: typeof fetch) {
  return new SupabaseDurableArtifactStore({
    projectUrl: 'https://project.supabase.co',
    bucket: 'execution-artifacts',
    accessToken: async () => 'service-token',
    residencyTags: ['US'],
    complianceTags: ['SOC2', 'HIPAA'],
    signedUrlTtlSeconds: 300,
    fetchImpl,
    now: () => new Date('2026-08-31T03:00:00.000Z'),
  });
}

test('SupabaseDurableArtifactStore uploads a deterministic immutable tenant artifact', async () => {
  let requestedUrl = '';
  let method = '';
  let headers: HeadersInit | undefined;

  const subject = store(async (resource, init) => {
    requestedUrl = String(resource);
    method = init?.method ?? '';
    headers = init?.headers;
    return new Response(JSON.stringify({ Id: '1', Key: 'key' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  const result = await subject.write(input);

  assert.equal(method, 'POST');
  assert.ok(requestedUrl.startsWith(
    'https://project.supabase.co/storage/v1/object/execution-artifacts/tenants/11111111-1111-4111-8111-111111111111/execution-artifacts/ai_invocation/ai_text/',
  ));
  assert.equal((headers as Record<string, string>)['x-upsert'], 'false');
  assert.equal(
    result.sha256,
    'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
  );
  assert.equal(result.byteLength, 11);
  assert.ok(result.contentReference.startsWith(
    'supabase-storage://execution-artifacts/tenants/11111111-1111-4111-8111-111111111111/',
  ));
});

test('SupabaseDurableArtifactStore treats an identical existing object as an idempotent replay', async () => {
  let calls = 0;
  const subject = store(async (_resource, init) => {
    calls += 1;
    if (init?.method === 'POST') {
      return new Response('already exists', { status: 409 });
    }
    return new Response('hello world', { status: 200 });
  });

  const result = await subject.write(input);

  assert.equal(calls, 2);
  assert.equal(result.byteLength, 11);
  assert.equal(
    result.sha256,
    'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
  );
});

test('SupabaseDurableArtifactStore refuses an immutable replay with different bytes', async () => {
  const subject = store(async (_resource, init) => {
    if (init?.method === 'POST') {
      return new Response('already exists', { status: 409 });
    }
    return new Response('different content', { status: 200 });
  });

  await assert.rejects(
    subject.write(input),
    /SUPABASE_STORAGE_IMMUTABLE_REPLAY_CONFLICT/,
  );
});

test('SupabaseDurableArtifactStore reads private text artifacts with tenant-scoped references', async () => {
  let requestedUrl = '';
  const subject = store(async (resource, init) => {
    requestedUrl = String(resource);
    assert.equal(init?.method, 'GET');
    return new Response('clinical note', { status: 200 });
  });

  const writtenReference =
    'supabase-storage://execution-artifacts/tenants/11111111-1111-4111-8111-111111111111/execution-artifacts/ai_invocation/ai_text/abc';

  const result = await subject.readText({
    tenantId: input.tenantId,
    reference: writtenReference,
    purpose: 'clinical extraction',
    requiredResidencyTags: ['US'],
    requiredComplianceTags: ['SOC2'],
  });

  assert.equal(result.content, 'clinical note');
  assert.equal(result.contentReference, writtenReference);
  assert.ok(requestedUrl.includes('/storage/v1/object/authenticated/execution-artifacts/'));
});

test('SupabaseDurableArtifactStore creates short-lived HTTPS provider fetch URLs', async () => {
  const subject = store(async (resource, init) => {
    assert.ok(String(resource).includes('/storage/v1/object/sign/execution-artifacts/'));
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), { expiresIn: 300 });
    return new Response(JSON.stringify({
      signedURL: '/object/sign/execution-artifacts/tenants/t/file?token=abc',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  const reference =
    'supabase-storage://execution-artifacts/tenants/11111111-1111-4111-8111-111111111111/execution-artifacts/voice_request/voice_audio/abc';

  const result = await subject.issueProviderFetchUrl({
    tenantId: input.tenantId,
    reference,
    purpose: 'voice transcription',
    requiredResidencyTags: ['US'],
    requiredComplianceTags: ['SOC2'],
  });

  assert.equal(
    result.providerFetchUrl,
    'https://project.supabase.co/storage/v1/object/sign/execution-artifacts/tenants/t/file?token=abc',
  );
  assert.equal(result.expiresAt, '2026-08-31T03:05:00.000Z');
  assert.equal(result.contentReference, reference);
});

test('SupabaseDurableArtifactStore fails closed when residency requirements are not met', async () => {
  const subject = store(async () => assert.fail('network must not run'));
  await assert.rejects(
    subject.write({
      ...input,
      requiredResidencyTags: ['EU'],
    }),
    /SUPABASE_STORAGE_RESIDENCY_REQUIREMENT_UNSATISFIED/,
  );
});

test('SupabaseDurableArtifactStore rejects cross-tenant artifact references before network access', async () => {
  const subject = store(async () => assert.fail('network must not run'));
  const otherTenantReference =
    'supabase-storage://execution-artifacts/tenants/22222222-2222-4222-8222-222222222222/execution-artifacts/ai_invocation/ai_text/abc';

  await assert.rejects(
    subject.readText({
      tenantId: input.tenantId,
      reference: otherTenantReference,
      purpose: 'read',
      requiredResidencyTags: ['US'],
      requiredComplianceTags: ['SOC2'],
    }),
    /SUPABASE_STORAGE_REFERENCE_TENANT_MISMATCH/,
  );
});
