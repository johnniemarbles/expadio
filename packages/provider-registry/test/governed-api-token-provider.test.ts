import assert from 'node:assert/strict';
import test from 'node:test';
import {
  credentialReference,
  governedApiTokenProvider,
  type ConnectorDefinition,
} from '../src/index.ts';

const connector: ConnectorDefinition = {
  connectorKey: 'connector.ai.openai.us',
  providerType: 'openai',
  providerKey: 'openai',
  ownership: 'PLATFORM',
  capabilityKeys: ['ai.generate'],
  residencyTags: ['US'],
  complianceTags: ['SOC2'],
  health: 'HEALTHY',
  priority: 100,
  enabled: true,
  fallbackEnabled: false,
  region: 'us-east-1',
};

test('governedApiTokenProvider leases the routed connector reference before secret resolution', async () => {
  const reference = credentialReference('vault://tenant/t1/connector/openai/v1');
  const calls: string[] = [];

  const tokenProvider = governedApiTokenProvider({
    connector,
    credentialRepository: {
      loadCredentialReference: async (tenantId, connectorKey) => {
        calls.push(`load:${tenantId}:${connectorKey}`);
        return reference;
      },
    },
    leaseService: {
      issue: async (request, leasedConnector) => {
        calls.push(`lease:${request.connectorKey}`);
        assert.equal(leasedConnector.credentialRef, reference);
        assert.equal(request.purpose, 'GENERATE:Draft summary');
        return {
          leaseReference: 'lease://1',
          tenantId: request.tenantId,
          connectorKey: request.connectorKey,
          credentialReference: reference,
          authorizationDecisionId: 'decision-1',
          issuedAt: '2026-08-31T02:00:00.000Z',
          expiresAt: '2026-08-31T02:05:00.000Z',
          auditReference: 'audit://1',
        };
      },
    },
    secretResolver: {
      resolve: async (leasedReference) => {
        calls.push('resolve');
        assert.equal(leasedReference, reference);
        return { value: 'provider-secret' };
      },
    },
    requestedBySubjectId: 'subject-1',
    requestId: () => 'request-1',
    correlationId: () => 'correlation-1',
    now: () => '2026-08-31T02:01:00.000Z',
  });

  const token = await tokenProvider({
    tenantId: '11111111-1111-4111-8111-111111111111',
    connectorKey: connector.connectorKey,
    operation: 'GENERATE',
    purpose: 'Draft summary',
    idempotencyKey: 'idem-1',
    requestedAt: '2026-08-31T02:00:00.000Z',
  });

  assert.equal(token, 'provider-secret');
  assert.deepEqual(calls, [
    'load:11111111-1111-4111-8111-111111111111:connector.ai.openai.us',
    'lease:connector.ai.openai.us',
    'resolve',
  ]);
});

test('governedApiTokenProvider fails closed when credential reference is missing', async () => {
  const tokenProvider = governedApiTokenProvider({
    connector,
    credentialRepository: {
      loadCredentialReference: async () => null,
    },
    leaseService: {
      issue: async () => assert.fail('lease must not be issued'),
    },
    secretResolver: {
      resolve: async () => assert.fail('secret must not be resolved'),
    },
    requestedBySubjectId: 'subject-1',
    requestId: () => 'request-1',
    correlationId: () => 'correlation-1',
  });

  await assert.rejects(
    tokenProvider({
      tenantId: '11111111-1111-4111-8111-111111111111',
      connectorKey: connector.connectorKey,
      operation: 'GENERATE',
      purpose: 'Draft summary',
      idempotencyKey: 'idem-1',
      requestedAt: '2026-08-31T02:00:00.000Z',
    }),
    /GOVERNED_API_CREDENTIAL_REFERENCE_UNAVAILABLE/,
  );
});

test('governedApiTokenProvider rejects expired leases before resolving secrets', async () => {
  const reference = credentialReference('vault://tenant/t1/connector/openai/v1');
  const tokenProvider = governedApiTokenProvider({
    connector,
    credentialRepository: {
      loadCredentialReference: async () => reference,
    },
    leaseService: {
      issue: async (request) => ({
        leaseReference: 'lease://expired',
        tenantId: request.tenantId,
        connectorKey: request.connectorKey,
        credentialReference: reference,
        authorizationDecisionId: 'decision-1',
        issuedAt: '2026-08-31T02:00:00.000Z',
        expiresAt: '2026-08-31T02:01:00.000Z',
        auditReference: 'audit://expired',
      }),
    },
    secretResolver: {
      resolve: async () => assert.fail('expired lease must not resolve secret'),
    },
    requestedBySubjectId: 'subject-1',
    requestId: () => 'request-1',
    correlationId: () => 'correlation-1',
    now: () => '2026-08-31T02:02:00.000Z',
  });

  await assert.rejects(
    tokenProvider({
      tenantId: '11111111-1111-4111-8111-111111111111',
      connectorKey: connector.connectorKey,
      operation: 'GENERATE',
      purpose: 'Draft summary',
      idempotencyKey: 'idem-1',
      requestedAt: '2026-08-31T02:00:00.000Z',
    }),
    /GOVERNED_API_CREDENTIAL_LEASE_INACTIVE/,
  );
});
