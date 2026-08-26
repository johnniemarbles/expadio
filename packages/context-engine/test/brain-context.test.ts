import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRAIN_SOURCE_PRECEDENCE,
  type BrainMapPayload,
  type BusinessConfigurationObject,
} from '@expadio/business-config';
import {
  assembleAuthorizedBrainContext,
  AuthorizedContextEngine,
  brainSourceContextKind,
  type ContextAuthorizationQuery,
  type ContextKind,
  type ContextProvider,
} from '../src/index.ts';

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const map: BusinessConfigurationObject<BrainMapPayload> = {
  kind: 'BRAIN_MAP', key: 'engineering-brain', version: 1,
  scope: { kind: 'TENANT', tenantId: 'tenant-1' },
  label: 'Engineering brain', state: 'PUBLISHED', dependencies: [],
  authoredBySubjectId: 'architect-1', authoredAt: '2026-08-26T00:00:00.000Z',
  payload: {
    tenantId: 'tenant-1', precedence: BRAIN_SOURCE_PRECEDENCE,
    sources: [
      {
        sourceId: 'policy-1', kind: 'TENANT_POLICY', status: 'APPROVED',
        sourceReference: 'config://policy/1', contentDigest: digest('a'),
        effectiveFrom: '2026-08-01T00:00:00.000Z', effectiveTo: null,
        classifications: ['RESTRICTED'],
      },
      {
        sourceId: 'fact-1', kind: 'VERIFIED_FACT', status: 'APPROVED',
        sourceReference: 'knowledge://fact/1', contentDigest: digest('b'),
        effectiveFrom: '2026-08-01T00:00:00.000Z', effectiveTo: null,
        classifications: ['INTERNAL'],
      },
    ],
    slices: [{
      sliceKey: 'engineering', purposeKeys: ['architecture.review'],
      sourceIds: ['fact-1', 'policy-1'], maxItems: 10,
    }],
  },
};

function provider(kind: 'POLICY' | 'KNOWLEDGE', loads: string[]): ContextProvider {
  return {
    kind,
    async load(input) {
      loads.push(`${kind}:${input.referenceId}`);
      return {
        kind, referenceId: input.referenceId, tenantId: input.tenantId,
        sourceReference: input.referenceId,
        observedAt: '2026-08-26T00:00:01.000Z', payload: { loaded: true },
      };
    },
  };
}

test('assembles a Brain slice through the existing authorization boundary', async () => {
  const queries: ContextAuthorizationQuery[] = [];
  const loads: string[] = [];
  const engine = new AuthorizedContextEngine({
    authorization: {
      async authorize(query) {
        queries.push(query);
        return { allowed: true, decisionId: `decision-${queries.length}`, reasonKey: 'GRANTED' };
      },
    },
    providers: [provider('POLICY', loads), provider('KNOWLEDGE', loads)],
    now: () => '2026-08-26T00:00:02.000Z',
  });

  const result = await assembleAuthorizedBrainContext(engine, map, {
    requestId: 'request-1', tenantId: 'tenant-1', requesterSubjectId: 'subject-1',
    requesterAgentId: 'agent-1', purposeKey: 'architecture.review',
    effectiveAt: '2026-08-26T00:00:00.000Z', requestedAt: '2026-08-26T00:00:00.000Z',
    correlationId: 'correlation-1', evidenceRefs: ['workflow://case/1'],
  });

  assert.deepEqual(
    queries.map((query) => query.reference),
    [
      { kind: 'POLICY', referenceId: 'config://policy/1' },
      { kind: 'KNOWLEDGE', referenceId: 'knowledge://fact/1' },
    ],
  );
  assert.deepEqual(loads, [
    'POLICY:config://policy/1',
    'KNOWLEDGE:knowledge://fact/1',
  ]);
  assert.deepEqual(result.expectedContentDigests, [digest('a'), digest('b')]);
  assert.equal(
    result.context.evidenceRefs.includes('business-config://BRAIN_MAP/engineering-brain@1'),
    true,
  );
});

test('maps every authoritative source class to an existing context boundary', () => {
  const kinds: readonly ContextKind[] = BRAIN_SOURCE_PRECEDENCE
    .filter((kind) => kind !== 'UNREVIEWED_PROPOSAL')
    .map(brainSourceContextKind);
  assert.deepEqual(kinds, [
    'POLICY', 'POLICY', 'POLICY', 'DECISION',
    'BUSINESS_EVENT', 'KNOWLEDGE', 'CAPABILITY',
  ]);
});
