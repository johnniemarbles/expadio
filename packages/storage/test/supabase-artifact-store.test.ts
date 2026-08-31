import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SupabaseDurableArtifactStore,
  governedSupabaseStorageAccessTokenProvider,
  type DurableArtifactWriteInput,
} from '../src/index.ts';
import {
  credentialReference,
  type ConnectorDefinition,
} from '@expadio/provider-registry';

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

function privateBucketResponse(publicBucket = false) {
  return new Response(JSON.stringify({
    id: 'execution-artifacts',
    name: 'execution-artifacts',
    public: publicBucket,
    type: 'STANDARD',
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isBucketRequest(resource: RequestInfo | URL): boolean {
  return String(resource).includes(
    '/storage/v1/bucket/execution-artifacts',
  );
}

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
    if (isBucketRequest(resource)) return privateBucketResponse();
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
  const subject = store(async (resource, init) => {
    calls += 1;
    if (isBucketRequest(resource)) return privateBucketResponse();
    if (init?.method === 'POST') {
      return new Response('already exists', { status: 409 });
    }
    return new Response('hello world', { status: 200 });
  });

  const result = await subject.write(input);

  assert.equal(calls, 4);
  assert.equal(result.byteLength, 11);
  assert.equal(
    result.sha256,
    'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
  );
});

test('SupabaseDurableArtifactStore refuses an immutable replay with different bytes', async () => {
  const subject = store(async (resource, init) => {
    if (isBucketRequest(resource)) return privateBucketResponse();
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
    if (isBucketRequest(resource)) return privateBucketResponse();
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
    if (isBucketRequest(resource)) return privateBucketResponse();
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


test('SupabaseDurableArtifactStore recognizes Supabase duplicate 400 responses without accepting generic bad requests', async () => {
  let duplicateCalls = 0;
  const duplicateStore = store(async (resource, init) => {
    duplicateCalls += 1;
    if (isBucketRequest(resource)) return privateBucketResponse();
    if (init?.method === 'POST') {
      return new Response('The resource already exists', { status: 400 });
    }
    return new Response('hello world', { status: 200 });
  });

  const replay = await duplicateStore.write(input);
  assert.equal(duplicateCalls, 4);
  assert.equal(replay.byteLength, 11);

  let malformedCalls = 0;
  const malformedStore = store(async (resource) => {
    malformedCalls += 1;
    if (isBucketRequest(resource)) return privateBucketResponse();
    return new Response('invalid bucket request', { status: 400 });
  });

  await assert.rejects(
    malformedStore.write(input),
    /SUPABASE_STORAGE_UPLOAD_FAILED:400/,
  );
  assert.equal(malformedCalls, 2);
});


test('governedSupabaseStorageAccessTokenProvider leases Supabase credentials before secret resolution', async () => {
  const reference = credentialReference('vault://platform/supabase-storage/v1');
  const connector: ConnectorDefinition = {
    connectorKey: 'connector.storage.supabase.primary',
    providerType: 'supabase-storage',
    providerKey: 'supabase',
    ownership: 'PLATFORM',
    capabilityKeys: ['storage.store', 'storage.read'],
    residencyTags: ['US'],
    complianceTags: ['SOC2'],
    health: 'HEALTHY',
    priority: 1,
    enabled: true,
    fallbackEnabled: false,
  };
  const calls: string[] = [];

  const provider = governedSupabaseStorageAccessTokenProvider({
    connector,
    credentialRepository: {
      loadCredentialReference: async () => {
        calls.push('credential-reference');
        return reference;
      },
    },
    leaseService: {
      issue: async (request, leasedConnector) => {
        calls.push('lease');
        assert.equal(request.connectorKey, connector.connectorKey);
        assert.equal(request.purpose, 'storage.store:artifact write');
        assert.equal(leasedConnector.credentialRef, reference);
        return {
          leaseReference: 'lease://storage/1',
          tenantId: request.tenantId,
          connectorKey: request.connectorKey,
          credentialReference: reference,
          authorizationDecisionId: 'decision-storage-1',
          issuedAt: '2026-08-31T03:00:00.000Z',
          expiresAt: '2026-08-31T03:05:00.000Z',
          auditReference: 'audit://storage/1',
        };
      },
    },
    secretResolver: {
      resolve: async () => {
        calls.push('secret');
        return { value: 'supabase-service-token' };
      },
    },
    requestedBySubjectId: 'service-artifact-runtime',
    requestId: () => 'credential-request-1',
    correlationId: () => 'corr-storage-1',
    now: () => '2026-08-31T03:01:00.000Z',
  });

  const token = await provider({
    tenantId: input.tenantId,
    operation: 'STORE',
    purpose: 'artifact write',
    idempotencyKey: 'storage:store:abc',
    requestedAt: '2026-08-31T03:00:00.000Z',
  });

  assert.equal(token, 'supabase-service-token');
  assert.deepEqual(calls, ['credential-reference', 'lease', 'secret']);
});

test('governedSupabaseStorageAccessTokenProvider refuses missing storage capabilities', async () => {
  const connector: ConnectorDefinition = {
    connectorKey: 'connector.storage.supabase.write-only',
    providerType: 'supabase-storage',
    providerKey: 'supabase',
    ownership: 'PLATFORM',
    capabilityKeys: ['storage.store'],
    residencyTags: ['US'],
    complianceTags: ['SOC2'],
    health: 'HEALTHY',
    priority: 1,
    enabled: true,
    fallbackEnabled: false,
  };

  const provider = governedSupabaseStorageAccessTokenProvider({
    connector,
    credentialRepository: {
      loadCredentialReference: async () => assert.fail('credential lookup must not run'),
    },
    leaseService: {
      issue: async () => assert.fail('lease must not run'),
    },
    secretResolver: {
      resolve: async () => assert.fail('secret resolution must not run'),
    },
    requestedBySubjectId: 'service-artifact-runtime',
    requestId: () => 'credential-request-2',
    correlationId: () => 'corr-storage-2',
  });

  await assert.rejects(
    provider({
      tenantId: input.tenantId,
      operation: 'READ',
      purpose: 'artifact read',
      idempotencyKey: 'storage:read:abc',
      requestedAt: '2026-08-31T03:00:00.000Z',
    }),
    /SUPABASE_STORAGE_CONNECTOR_CAPABILITY_UNAVAILABLE/,
  );
});


test('SupabaseDurableArtifactStore refuses public buckets before object access', async () => {
  let calls = 0;
  const subject = store(async (resource) => {
    calls += 1;
    if (isBucketRequest(resource)) return privateBucketResponse(true);
    return assert.fail('artifact object request must not run for a public bucket');
  });

  await assert.rejects(
    subject.write(input),
    /SUPABASE_STORAGE_PRIVATE_BUCKET_REQUIRED/,
  );
  assert.equal(calls, 1);
});
