import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConnectorDefinition, CredentialReference, CredentialLease } from '@expadio/provider-registry';
import {
  GovernedResendCredentialError,
  governedResendApiTokenProvider,
} from '../src/governed-resend-binding.ts';

const tenantId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const credentialRef = 'vault://tenant-a/resend' as CredentialReference;
const connector: ConnectorDefinition = {
  connectorKey: 'tenant-email-primary',
  providerType: 'email',
  providerKey: 'resend',
  ownership: 'TENANT',
  tenantId,
  capabilityKeys: ['communication.email.send'],
  residencyTags: ['CA'],
  complianceTags: ['PIPEDA'],
  health: 'HEALTHY',
  priority: 1,
  enabled: true,
  fallbackEnabled: false,
};
const request = {
  tenantId,
  organizationId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  triggerKey: 'lead.welcome',
  idempotencyKey: 'welcome-1',
  purpose: 'transactional' as const,
  requestedAt: '2026-08-26T18:00:00.000Z',
};

test('loads, leases, audits, then resolves a connector-bound Resend credential', async () => {
  const calls: string[] = [];
  const provider = governedResendApiTokenProvider({
    connector,
    requestedBySubjectId: 'worker:communication-dispatch',
    requestId: () => 'credential-request-1',
    correlationId: () => 'correlation-1',
    now: () => '2026-08-26T18:00:00.000Z',
    credentialRepository: {
      async loadCredentialReference(actualTenantId, connectorKey) {
        calls.push(`reference:${actualTenantId}:${connectorKey}`);
        return credentialRef;
      },
    },
    leaseService: {
      async issue(actualRequest, actualConnector) {
        calls.push(`lease:${actualRequest.requestId}`);
        assert.equal(actualConnector.credentialRef, credentialRef);
        assert.deepEqual(actualRequest.evidenceRefs, [
          'communication://trigger/lead.welcome',
          'communication://idempotency/welcome-1',
        ]);
        return {
          leaseReference: 'lease://resend/1',
          tenantId,
          connectorKey: connector.connectorKey,
          credentialReference: credentialRef,
          authorizationDecisionId: 'decision-1',
          issuedAt: '2026-08-26T17:59:59.000Z',
          expiresAt: '2026-08-26T18:05:00.000Z',
          auditReference: 'audit://credential-lease/1',
        };
      },
    },
    secretResolver: {
      async resolve(reference) {
        calls.push(`secret:${reference}`);
        return { value: 're_live_token', version: '7' };
      },
    },
  });

  assert.equal(await provider(request), 're_live_token');
  assert.deepEqual(calls, [
    `reference:${tenantId}:tenant-email-primary`,
    'lease:credential-request-1',
    'secret:vault://tenant-a/resend',
  ]);
});

test('missing credential reference fails before authorization and secret resolution', async () => {
  let leaseCalled = false;
  let secretCalled = false;
  const provider = governedResendApiTokenProvider({
    connector,
    requestedBySubjectId: 'worker:communication-dispatch',
    requestId: () => 'credential-request-2',
    correlationId: () => 'correlation-2',
    now: () => '2026-08-26T18:00:00.000Z',
    credentialRepository: { async loadCredentialReference() { return null; } },
    leaseService: { async issue() { leaseCalled = true; throw new Error('must not run'); } },
    secretResolver: { async resolve() { secretCalled = true; throw new Error('must not run'); } },
  });

  await assert.rejects(
    () => provider(request),
    (error: unknown) => error instanceof GovernedResendCredentialError
      && error.code === 'RESEND_CREDENTIAL_REFERENCE_UNAVAILABLE',
  );
  assert.equal(leaseCalled, false);
  assert.equal(secretCalled, false);
});

test('rejects invalid connectors before credential repository access', () => {
  let repositoryCalled = false;
  assert.throws(
    () => governedResendApiTokenProvider({
      connector: { ...connector, providerKey: 'sendgrid' },
      requestedBySubjectId: 'worker:communication-dispatch',
      requestId: () => 'credential-request-3',
      correlationId: () => 'correlation-3',
      now: () => '2026-08-26T18:00:00.000Z',
      credentialRepository: { async loadCredentialReference() { repositoryCalled = true; return credentialRef; } },
      leaseService: { async issue() { throw new Error('must not run'); } },
      secretResolver: { async resolve() { throw new Error('must not run'); } },
    }),
    (error: unknown) => error instanceof GovernedResendCredentialError
      && error.code === 'RESEND_CONNECTOR_INVALID',
  );
  assert.equal(repositoryCalled, false);
});

test('does not release an expired resolved secret to the provider adapter', async () => {
  const provider = governedResendApiTokenProvider({
    connector,
    requestedBySubjectId: 'worker:communication-dispatch',
    requestId: () => 'credential-request-4',
    correlationId: () => 'correlation-4',
    now: () => '2026-08-26T18:00:00.000Z',
    credentialRepository: { async loadCredentialReference() { return credentialRef; } },
    leaseService: {
      async issue() {
        return {
          leaseReference: 'lease://resend/4', tenantId, connectorKey: connector.connectorKey,
          credentialReference: credentialRef, authorizationDecisionId: 'decision-4',
          issuedAt: '2026-08-26T17:59:59.000Z', expiresAt: '2026-08-26T18:05:00.000Z',
          auditReference: 'audit://credential-lease/4',
        };
      },
    },
    secretResolver: {
      async resolve() { return { value: 'expired', expiresAt: new Date('2026-08-26T17:59:00.000Z') }; },
    },
  });

  await assert.rejects(
    () => provider(request),
    (error: unknown) => error instanceof GovernedResendCredentialError
      && error.code === 'RESEND_SECRET_EXPIRED',
  );
});

const validLease: CredentialLease = {
  leaseReference: 'lease://resend/shared', tenantId, connectorKey: connector.connectorKey,
  credentialReference: credentialRef, authorizationDecisionId: 'decision-shared',
  issuedAt: '2026-08-26T17:59:59.000Z', expiresAt: '2026-08-26T18:01:00.000Z',
  auditReference: 'audit://credential-lease/shared',
};

for (const mismatch of [
  { tenantId: 'another-brand' }, { connectorKey: 'another-connector' },
  { credentialReference: 'vault://another/secret' as CredentialReference },
]) {
  test(`rejects a mismatched ${Object.keys(mismatch)[0]} before reading a secret`, async () => {
    let secretReads = 0;
    const provider = governedResendApiTokenProvider({
      connector, requestedBySubjectId: 'worker:communications',
      requestId: () => 'request', correlationId: () => 'correlation',
      now: () => request.requestedAt,
      credentialRepository: { async loadCredentialReference() { return credentialRef; } },
      leaseService: { async issue() { return { ...validLease, ...mismatch }; } },
      secretResolver: { async resolve() { secretReads++; return { value: 'secret' }; } },
    });
    await assert.rejects(provider(request), (error: unknown) =>
      error instanceof GovernedResendCredentialError && error.code === 'RESEND_CREDENTIAL_LEASE_MISMATCH');
    assert.equal(secretReads, 0);
  });
}

for (const scenario of ['lease expires during read', 'secret expires during read', 'invalid secret expiry']) {
  test(`does not release a token when ${scenario}`, async () => {
    let now = request.requestedAt;
    const provider = governedResendApiTokenProvider({
      connector, requestedBySubjectId: 'worker:communications',
      requestId: () => 'request', correlationId: () => 'correlation', now: () => now,
      credentialRepository: { async loadCredentialReference() { return credentialRef; } },
      leaseService: { async issue() { return validLease; } },
      secretResolver: { async resolve() {
        now = scenario === 'lease expires during read' ? validLease.expiresAt : '2026-08-26T18:00:30.000Z';
        return { value: 'must-not-escape', ...(scenario === 'lease expires during read' ? {} : {
          expiresAt: new Date(scenario === 'invalid secret expiry' ? 'invalid' : '2026-08-26T18:00:15.000Z'),
        }) };
      } },
    });
    await assert.rejects(provider(request), (error: unknown) =>
      error instanceof GovernedResendCredentialError && error.code === 'RESEND_SECRET_EXPIRED');
  });
}

test('one platform credential serves two brands through distinct tenant-scoped leases', async () => {
  const { tenantId: _ownerTenant, ...shared } = connector;
  const brands = [tenantId, 'cccccccc-cccc-cccc-cccc-cccccccccccc'];
  const leases: CredentialLease[] = [];
  const resolutions: string[] = [];
  let serial = 0;
  const provider = governedResendApiTokenProvider({
    connector: { ...shared, ownership: 'PLATFORM' }, requestedBySubjectId: 'worker:communications',
    requestId: () => `request-${++serial}`, correlationId: () => `correlation-${serial}`,
    now: () => request.requestedAt,
    credentialRepository: { async loadCredentialReference(brand, key) {
      assert.ok(brands.includes(brand)); assert.equal(key, shared.connectorKey);
      return credentialRef;
    } },
    leaseService: { async issue(input, selected) {
      assert.equal(selected.ownership, 'PLATFORM');
      assert.equal(selected.tenantId, undefined);
      assert.equal(selected.credentialRef, credentialRef);
      assert.equal(input.requestedBySubjectId, 'worker:communications');
      const lease = { ...validLease, tenantId: input.tenantId,
        leaseReference: `lease://${input.requestId}`, auditReference: `audit://${input.requestId}` };
      leases.push(lease); return lease;
    } },
    secretResolver: { async resolve(ref) { resolutions.push(ref); return { value: 'shared-platform-token' }; } },
  });
  for (const brand of brands) assert.equal(await provider({ ...request, tenantId: brand }), 'shared-platform-token');
  assert.deepEqual(leases.map(lease => lease.tenantId), brands);
  assert.notEqual(leases[0]!.leaseReference, leases[1]!.leaseReference);
  assert.notEqual(leases[0]!.auditReference, leases[1]!.auditReference);
  assert.deepEqual(resolutions, [credentialRef, credentialRef]);
  assert.ok(leases.every(lease => !JSON.stringify(lease).includes('shared-platform-token')));
});
