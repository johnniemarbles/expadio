import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateDataOrchestrationIntent,
  validateDataOrchestrationObservation,
  type DataOrchestrationIntent,
  type DataOrchestrationObservation,
} from '../src/index.ts';

const intent: DataOrchestrationIntent = {
  workId: 'work-1',
  tenantId: 'tenant-1',
  purpose: 'Extract and propose a governed projection.',
  sourceEventReference: 'event://tenant-1/inbound-1',
  stages: [
    'INGEST',
    'EXTRACT',
    'TRANSFORM',
    'RESOLVE_ENTITIES',
    'VALIDATE_ONTOLOGY',
    'APPLY_POLICY',
    'PROPOSE_PROJECTION',
  ],
  ontology: { key: 'service-ontology', version: 3 },
  policies: [{ key: 'projection-policy', version: 2 }],
  idempotencyKey: 'orchestrate:inbound-1:v3',
  requestedBySubjectId: 'workflow-1',
  requestedAt: '2026-08-25T15:00:00.000Z',
  correlationId: 'correlation-1',
  evidenceRefs: ['inbound:event-1'],
};

const observation: DataOrchestrationObservation = {
  workId: intent.workId,
  tenantId: intent.tenantId,
  status: 'PROPOSAL',
  stageOutputs: [
    { stage: 'EXTRACT', outputReference: 'object://tenant-1/extract-1' },
    {
      stage: 'PROPOSE_PROJECTION',
      outputReference: 'proposal://tenant-1/projection-1',
    },
  ],
  provenance: {
    sourceReferences: [intent.sourceEventReference],
    completedAt: '2026-08-25T15:00:05.000Z',
  },
};

test('validates a governed data-orchestration plan', () => {
  assert.deepEqual(
    validateDataOrchestrationIntent(intent),
    { valid: true, issues: [] },
  );
});

test('requires ontology validation and policy before mutation proposals', () => {
  const result = validateDataOrchestrationIntent({
    ...intent,
    stages: ['INGEST', 'EXTRACT', 'PROPOSE_PROJECTION'],
  });
  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.equal(
    result.issues.some((issue) =>
      issue.code === 'DATA_PROPOSAL_GOVERNANCE_REQUIRED'
    ),
    true,
  );
});

test('rejects duplicate or out-of-order stages', () => {
  const result = validateDataOrchestrationIntent({
    ...intent,
    stages: ['EXTRACT', 'INGEST', 'EXTRACT'],
  });
  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.deepEqual(
    new Set(result.issues.map((issue) => issue.code)),
    new Set(['DATA_STAGE_ORDER_INVALID', 'DATA_STAGE_DUPLICATE']),
  );
});

test('validates reference-only stage output provenance', () => {
  assert.deepEqual(
    validateDataOrchestrationObservation(intent, observation),
    { valid: true, issues: [] },
  );
});

test('rejects cross-tenant and unrequested outputs', () => {
  const result = validateDataOrchestrationObservation(intent, {
    ...observation,
    tenantId: 'tenant-2',
    stageOutputs: [
      { stage: 'INDEX', outputReference: '' },
      { stage: 'INDEX', outputReference: 'index://tenant-2/index-1' },
    ],
    provenance: { sourceReferences: [], completedAt: 'invalid' },
  });

  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.deepEqual(
    new Set(result.issues.map((issue) => issue.code)),
    new Set([
      'DATA_OBSERVATION_IDENTITY_MISMATCH',
      'DATA_STAGE_OUTPUT_UNREQUESTED',
      'DATA_STAGE_OUTPUT_REFERENCE_REQUIRED',
      'DATA_STAGE_OUTPUT_DUPLICATE',
      'DATA_PROVENANCE_SOURCE_REQUIRED',
      'DATA_COMPLETED_AT_INVALID',
    ]),
  );
});
