import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentCapabilityResolutionError,
  PublishedAgentCapabilityResolver,
  type AgentCapabilityManifest,
  type AgentCapabilityManifestRepository,
} from '../src/index.ts';

const digest = `sha256:${'b'.repeat(64)}`;

function manifest(
  overrides: Partial<AgentCapabilityManifest> = {},
): AgentCapabilityManifest {
  return {
    kind: 'SKILL',
    key: 'source-verify',
    version: 1,
    state: 'PUBLISHED',
    scope: { kind: 'PLATFORM' },
    ownerSubjectId: 'owner-1',
    instructionReference: 'instruction://source-verify/1',
    instructionDigest: digest,
    inputSchema: {
      schemaReference: 'schema://source-verify/input/1',
      schemaDigest: digest,
    },
    outputSchema: {
      schemaReference: 'schema://source-verify/output/1',
      schemaDigest: digest,
    },
    requiredPermissionKeys: ['knowledge.read'],
    allowedToolKeys: ['knowledge.search'],
    negativeConstraintKeys: ['NO_DIRECT_MUTATION'],
    budgetPolicyReference: 'budget://agent/default',
    maxSteps: 8,
    maxCostMinorUnits: 250,
    timeoutSeconds: 90,
    stopConditionKeys: ['OBJECTIVE_MET'],
    escalationPolicyReference: 'escalation://human-review',
    skillReferences: [],
    verifiedAt: '2026-08-25T00:00:00.000Z',
    effectiveFrom: '2026-08-25T00:00:00.000Z',
    evidenceRefs: ['verification://source-verify/1'],
    ...overrides,
  };
}

function repository(
  manifests: readonly AgentCapabilityManifest[],
): AgentCapabilityManifestRepository {
  return {
    async findByKindAndKey(kind, key) {
      return manifests.filter(
        (candidate) => candidate.kind === kind && candidate.key === key,
      );
    },
  };
}

const query = {
  kind: 'SKILL' as const,
  key: 'source-verify',
  tenantId: 'tenant-1',
  verticalKeys: ['dentex'],
  effectiveAt: '2026-08-26T00:00:00.000Z',
};

test('prefers tenant scope before vertical and platform scope', async () => {
  const platform = manifest();
  const vertical = manifest({ scope: { kind: 'VERTICAL', verticalKey: 'dentex' } });
  const tenant = manifest({ scope: { kind: 'TENANT', tenantId: 'tenant-1' } });
  const resolver = new PublishedAgentCapabilityResolver(
    repository([platform, vertical, tenant]),
  );

  const resolved = await resolver.resolve(query);

  assert.deepEqual(resolved.manifest.scope, {
    kind: 'TENANT',
    tenantId: 'tenant-1',
  });
});

test('chooses the latest effective published version within the winning scope', async () => {
  const resolver = new PublishedAgentCapabilityResolver(repository([
    manifest({ version: 1 }),
    manifest({ version: 2 }),
    manifest({ version: 3, state: 'DRAFT', verifiedAt: null }),
    manifest({
      version: 4,
      effectiveFrom: '2026-08-27T00:00:00.000Z',
      verifiedAt: '2026-08-27T00:00:00.000Z',
    }),
  ]));

  const resolved = await resolver.resolve(query);

  assert.equal(resolved.manifest.version, 2);
});

test('resolves a worker only with exact published skills allowed by worker scope', async () => {
  const skill = manifest({
    scope: { kind: 'VERTICAL', verticalKey: 'dentex' },
  });
  const otherTenantSkill = manifest({
    scope: { kind: 'TENANT', tenantId: 'tenant-2' },
  });
  const worker = manifest({
    kind: 'WORKER',
    key: 'knowledge-worker',
    scope: { kind: 'VERTICAL', verticalKey: 'dentex' },
    skillReferences: [{ key: 'source-verify', version: 1 }],
  });
  const resolver = new PublishedAgentCapabilityResolver(
    repository([otherTenantSkill, skill, worker]),
  );

  const resolved = await resolver.resolve({
    ...query,
    kind: 'WORKER',
    key: 'knowledge-worker',
  });

  assert.equal(resolved.resolvedSkills.length, 1);
  assert.deepEqual(resolved.resolvedSkills[0]?.scope, {
    kind: 'VERTICAL',
    verticalKey: 'dentex',
  });
});

test('rejects a worker whose versioned skill is not published in scope', async () => {
  const worker = manifest({
    kind: 'WORKER',
    key: 'knowledge-worker',
    skillReferences: [{ key: 'source-verify', version: 2 }],
  });
  const resolver = new PublishedAgentCapabilityResolver(
    repository([manifest(), worker]),
  );

  await assert.rejects(
    () => resolver.resolve({
      ...query,
      kind: 'WORKER',
      key: 'knowledge-worker',
    }),
    (error: unknown) =>
      error instanceof AgentCapabilityResolutionError
      && error.code === 'AGENT_CAPABILITY_SKILL_NOT_FOUND'
      && error.capabilityKey === 'source-verify',
  );
});

test('does not expose draft, retired, future, or other-tenant capabilities', async () => {
  const resolver = new PublishedAgentCapabilityResolver(repository([
    manifest({ state: 'DRAFT', verifiedAt: null }),
    manifest({ version: 2, state: 'RETIRED' }),
    manifest({
      version: 3,
      scope: { kind: 'TENANT', tenantId: 'tenant-2' },
    }),
  ]));

  await assert.rejects(
    () => resolver.resolve(query),
    (error: unknown) =>
      error instanceof AgentCapabilityResolutionError
      && error.code === 'AGENT_CAPABILITY_NOT_FOUND',
  );
});
