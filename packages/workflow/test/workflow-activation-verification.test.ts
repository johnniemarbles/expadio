import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  WorkflowActivationVerificationRequest,
  WorkflowActivationVerificationRecord,
} from '../src/index.ts';

const request: WorkflowActivationVerificationRequest = {
  verificationId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  instanceId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  activationId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  assessments: [
    { dimension: 'AGREEMENT', outcome: 'SATISFIED', reason: 'Executed agreement is current.', evidenceRefs: ['agreement:1'] },
    { dimension: 'RIGHTS', outcome: 'SATISFIED', reason: 'Source rights remain active.', evidenceRefs: ['rights:1'] },
    { dimension: 'ACCESS', outcome: 'SATISFIED', reason: 'Provisioned access was tested.', evidenceRefs: ['access-test:1'] },
    { dimension: 'COMPLIANCE', outcome: 'SATISFIED', reason: 'Required compliance controls passed.', evidenceRefs: ['compliance:1'] },
    { dimension: 'OPERATIONAL_READINESS', outcome: 'SATISFIED', reason: 'Operational checklist completed.', evidenceRefs: ['readiness:1'] },
  ],
  verifiedBySubjectId: 'verifier-1',
  verifiedAt: '2026-08-25T13:30:00.000Z',
  reason: 'All activation controls independently verified.',
  evidenceRefs: ['verification-pack:1'],
};

test('verification contract keeps all five control dimensions independent', () => {
  assert.deepEqual(request.assessments.map((entry) => entry.dimension), [
    'AGREEMENT',
    'RIGHTS',
    'ACCESS',
    'COMPLIANCE',
    'OPERATIONAL_READINESS',
  ]);
  assert.equal(request.verifiedBySubjectId, 'verifier-1');
  assert.equal(request.evidenceRefs.length, 1);
});

test('verification record is a separate audit fact from activation start', () => {
  const record: WorkflowActivationVerificationRecord = { ...request, state: 'VERIFIED' };
  assert.equal(record.state, 'VERIFIED');
  assert.equal(record.activationId, request.activationId);
  assert.equal('provisioningModel' in record, false);
});
