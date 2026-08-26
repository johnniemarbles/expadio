import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentCapabilityManifestError,
  validateAgentCapabilityManifest,
  type AgentCapabilityManifest,
} from '../src/index.ts';

const digest = `sha256:${'a'.repeat(64)}`;
const skill: AgentCapabilityManifest = {
  kind: 'SKILL', key: 'architecture-review', version: 1, state: 'PUBLISHED',
  scope: { kind: 'TENANT', tenantId: 'tenant-1' }, ownerSubjectId: 'owner-1',
  instructionReference: 'instruction://skill/1', instructionDigest: digest,
  inputSchema: { schemaReference: 'schema://input/1', schemaDigest: digest },
  outputSchema: { schemaReference: 'schema://output/1', schemaDigest: digest },
  requiredPermissionKeys: ['architecture.read'], allowedToolKeys: ['repository.search'],
  negativeConstraintKeys: ['NO_DIRECT_MUTATION'], budgetPolicyReference: 'budget://policy/1',
  maxSteps: 10, maxCostMinorUnits: 500, timeoutSeconds: 120,
  stopConditionKeys: ['OBJECTIVE_MET'], escalationPolicyReference: 'escalation://policy/1',
  skillReferences: [], verifiedAt: '2026-08-26T00:00:00.000Z',
  effectiveFrom: '2026-08-26T00:00:00.000Z', evidenceRefs: ['test://skill/1'],
};

test('accepts a bounded reference-only skill manifest', () => {
  assert.doesNotThrow(() => validateAgentCapabilityManifest(skill));
});

test('accepts a worker composed from versioned skills', () => {
  assert.doesNotThrow(() => validateAgentCapabilityManifest({
    ...skill, kind: 'WORKER', key: 'architecture-worker',
    skillReferences: [{ key: skill.key, version: skill.version }],
  }));
});

test('requires verification before publication', () => {
  assert.throws(
    () => validateAgentCapabilityManifest({ ...skill, verifiedAt: null }),
    (error) => error instanceof AgentCapabilityManifestError
      && error.code === 'AGENT_CAPABILITY_MANIFEST_VERIFICATION_REQUIRED',
  );
});

test('rejects raw instructions and recursive skills', () => {
  assert.throws(
    () => validateAgentCapabilityManifest({
      ...skill, rawInstructions: 'protected prompt',
    } as AgentCapabilityManifest),
    (error) => error instanceof AgentCapabilityManifestError
      && error.code === 'AGENT_CAPABILITY_MANIFEST_UNEXPECTED_FIELD',
  );
  assert.throws(
    () => validateAgentCapabilityManifest({
      ...skill, skillReferences: [{ key: 'nested', version: 1 }],
    }),
    (error) => error instanceof AgentCapabilityManifestError
      && error.code === 'AGENT_CAPABILITY_SKILL_REFERENCE_INVALID',
  );
});
