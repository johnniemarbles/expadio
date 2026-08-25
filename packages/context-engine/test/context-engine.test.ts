import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AuthorizedContextEngine,
  ContextEngineError,
  type ContextAssemblyRequest,
  type ContextAuthorizationQuery,
  type ContextProvider,
  type ContextRecord,
} from '../src/index.ts';

const request: ContextAssemblyRequest = {
  requestId: 'context-request-1',
  tenantId: 'tenant-1',
  requesterSubjectId: 'subject-1',
  requesterAgentId: 'agent-1',
  purpose: 'Prepare an authorized account briefing.',
  references: [
    { kind: 'TENANT', referenceId: 'tenant-1' },
    { kind: 'CRM_RECORD', referenceId: 'account-7' },
  ],
  requestedAt: '2026-08-25T16:00:00.000Z',
  correlationId: 'correlation-1',
  evidenceRefs: ['evidence://workflow/42'],
};

function provider(
  kind: 'TENANT' | 'CRM_RECORD',
  loads: string[],
  override: Partial<ContextRecord> = {},
): ContextProvider {
  return {
    kind,
    async load(input) {
      loads.push(kind + ':' + input.referenceId);
      return {
        kind,
        referenceId: input.referenceId,
        tenantId: input.tenantId,
        sourceReference: 'source://' + kind.toLowerCase() + '/' + input.referenceId,
        observedAt: '2026-08-25T16:00:01.000Z',
        payload: { label: input.referenceId },
        ...override,
      };
    },
  };
}

test('authorizes every reference before loading and preserves audit provenance', async () => {
  const authorizations: ContextAuthorizationQuery[] = [];
  const loads: string[] = [];
  const engine = new AuthorizedContextEngine({
    authorization: {
      async authorize(query) {
        authorizations.push(query);
        return {
          allowed: true,
          decisionId: 'decision-' + authorizations.length,
          reasonKey: 'GRANTED',
        };
      },
    },
    providers: [
      provider('TENANT', loads),
      provider('CRM_RECORD', loads),
    ],
    now: () => '2026-08-25T16:00:02.000Z',
  });

  const bundle = await engine.assemble(request);

  assert.deepEqual(
    authorizations.map(({ action, reference }) => ({ action, reference })),
    [
      {
        action: 'context.read',
        reference: { kind: 'TENANT', referenceId: 'tenant-1' },
      },
      {
        action: 'context.read',
        reference: { kind: 'CRM_RECORD', referenceId: 'account-7' },
      },
    ],
  );
  assert.deepEqual(loads, [
    'TENANT:tenant-1',
    'CRM_RECORD:account-7',
  ]);
  assert.deepEqual(
    bundle.items.map((item) => item.authorizationDecisionId),
    ['decision-1', 'decision-2'],
  );
  assert.deepEqual(bundle.sourceReferences, [
    'source://tenant/tenant-1',
    'source://crm_record/account-7',
  ]);
});

test('denies the complete bundle before any provider is loaded', async () => {
  const authorizations: string[] = [];
  const loads: string[] = [];
  const engine = new AuthorizedContextEngine({
    authorization: {
      async authorize(query) {
        authorizations.push(query.reference.referenceId);
        return {
          allowed: query.reference.kind !== 'CRM_RECORD',
          decisionId: 'decision-' + query.reference.referenceId,
          reasonKey:
            query.reference.kind === 'CRM_RECORD'
              ? 'SCOPE_MISMATCH'
              : 'GRANTED',
        };
      },
    },
    providers: [
      provider('TENANT', loads),
      provider('CRM_RECORD', loads),
    ],
    now: () => '2026-08-25T16:00:02.000Z',
  });

  await assert.rejects(
    () => engine.assemble(request),
    (error: unknown) =>
      error instanceof ContextEngineError
      && error.code === 'CONTEXT_ACCESS_DENIED'
      && error.reasonKey === 'SCOPE_MISMATCH',
  );
  assert.deepEqual(authorizations, ['tenant-1', 'account-7']);
  assert.deepEqual(loads, []);
});

test('fails closed when a requested context kind has no provider', async () => {
  let authorizationCalls = 0;
  const loads: string[] = [];
  const engine = new AuthorizedContextEngine({
    authorization: {
      async authorize() {
        authorizationCalls += 1;
        return {
          allowed: true,
          decisionId: 'decision-1',
          reasonKey: 'GRANTED',
        };
      },
    },
    providers: [provider('TENANT', loads)],
    now: () => '2026-08-25T16:00:02.000Z',
  });

  await assert.rejects(
    () => engine.assemble(request),
    (error: unknown) =>
      error instanceof ContextEngineError
      && error.code === 'CONTEXT_PROVIDER_MISSING',
  );
  assert.equal(authorizationCalls, 0);
  assert.deepEqual(loads, []);
});

test('rejects provider output from another tenant or reference', async () => {
  const loads: string[] = [];
  const engine = new AuthorizedContextEngine({
    authorization: {
      async authorize(query) {
        return {
          allowed: true,
          decisionId: 'decision-' + query.reference.referenceId,
          reasonKey: 'GRANTED',
        };
      },
    },
    providers: [
      provider('TENANT', loads),
      provider('CRM_RECORD', loads, { tenantId: 'tenant-2' }),
    ],
    now: () => '2026-08-25T16:00:02.000Z',
  });

  await assert.rejects(
    () => engine.assemble(request),
    (error: unknown) =>
      error instanceof ContextEngineError
      && error.code === 'CONTEXT_RECORD_IDENTITY_MISMATCH',
  );
});

test('rejects ambiguous provider registration', () => {
  assert.throws(
    () =>
      new AuthorizedContextEngine({
        authorization: {
          async authorize() {
            return {
              allowed: true,
              decisionId: 'decision-1',
              reasonKey: 'GRANTED',
            };
          },
        },
        providers: [
          provider('TENANT', []),
          provider('TENANT', []),
        ],
        now: () => '2026-08-25T16:00:02.000Z',
      }),
    (error: unknown) =>
      error instanceof ContextEngineError
      && error.code === 'CONTEXT_PROVIDER_DUPLICATE',
  );
});
