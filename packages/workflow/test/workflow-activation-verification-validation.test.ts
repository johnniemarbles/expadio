import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowActivationVerificationRequest } from '../src/index.ts';
import { validateWorkflowActivationVerification } from '../src/index.ts';

const request: WorkflowActivationVerificationRequest = {
  verificationId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  instanceId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  activationId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  assessments: [
    { dimension: 'AGREEMENT', outcome: 'SATISFIED', reason: 'Current.', evidenceRefs: ['agreement:1'] },
    { dimension: 'RIGHTS', outcome: 'SATISFIED', reason: 'Active.', evidenceRefs: ['rights:1'] },
    { dimension: 'ACCESS', outcome: 'SATISFIED', reason: 'Tested.', evidenceRefs: ['access:1'] },
    { dimension: 'COMPLIANCE', outcome: 'SATISFIED', reason: 'Passed.', evidenceRefs: ['compliance:1'] },
    { dimension: 'OPERATIONAL_READINESS', outcome: 'SATISFIED', reason: 'Ready.', evidenceRefs: ['readiness:1'] },
  ],
  verifiedBySubjectId: 'verifier-1',
  verifiedAt: '2026-08-25T13:30:00.000Z',
  reason: 'Independent checks completed.',
  evidenceRefs: ['verification-pack:1'],
};

test('accepts one evidence-backed assessment for every dimension', () => {
  assert.deepEqual(validateWorkflowActivationVerification(request), {
    valid: true,
    issues: [],
  });
});

test('rejects missing and duplicate verification dimensions', () => {
  const result = validateWorkflowActivationVerification({
    ...request,
    assessments: [
      ...request.assessments.filter((entry) => entry.dimension !== 'ACCESS'),
      request.assessments[0]!,
    ],
  });
  assert.deepEqual(result.issues.map((entry) => entry.code), [
    'ACTIVATION_VERIFICATION_DIMENSION_DUPLICATE',
    'ACTIVATION_VERIFICATION_DIMENSION_MISSING',
  ]);
});

test('rejects invalid audit metadata and unsupported evidence gaps', () => {
  const result = validateWorkflowActivationVerification({
    ...request,
    verificationId: ' ',
    verifiedBySubjectId: '',
    verifiedAt: 'not-an-instant',
    reason: ' ',
    evidenceRefs: [],
    assessments: request.assessments.map((entry, index) =>
      index === 0 ? { ...entry, reason: '', evidenceRefs: [] } : entry
    ),
  });
  assert.deepEqual(result.issues.map((entry) => entry.code), [
    'ACTIVATION_VERIFICATION_ID_REQUIRED',
    'ACTIVATION_VERIFIER_REQUIRED',
    'ACTIVATION_VERIFICATION_REASON_REQUIRED',
    'ACTIVATION_VERIFIED_AT_INVALID',
    'ACTIVATION_VERIFICATION_EVIDENCE_REQUIRED',
    'ACTIVATION_VERIFICATION_ASSESSMENT_REASON_REQUIRED',
    'ACTIVATION_VERIFICATION_ASSESSMENT_EVIDENCE_REQUIRED',
  ]);
});

test('allows NOT_APPLICABLE without evidence but still requires a reason', () => {
  const result = validateWorkflowActivationVerification({
    ...request,
    assessments: request.assessments.map((entry) =>
      entry.dimension === 'ACCESS'
        ? { ...entry, outcome: 'NOT_APPLICABLE', reason: 'No provisioning model.', evidenceRefs: [] }
        : entry
    ),
  });
  assert.equal(result.valid, true);
});
