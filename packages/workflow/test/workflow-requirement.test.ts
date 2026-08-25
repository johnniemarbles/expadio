import assert from 'node:assert/strict';
import test from 'node:test';
import { isWorkflowRequirementBlocking } from '../src/workflow-requirement.ts';

test('satisfied requirement is non-blocking', () => {
  assert.equal(isWorkflowRequirementBlocking({
    requirementKey: 'identity-check',
    state: 'SATISFIED',
    waiver: { allowed: false, applied: false },
    code: 'REQUIREMENT_SATISFIED',
    evidenceRefs: ['document:123'],
  }), false);
});

test('properly applied allowed waiver is non-blocking', () => {
  assert.equal(isWorkflowRequirementBlocking({
    requirementKey: 'optional-reference',
    state: 'WAIVED',
    waiver: { allowed: true, applied: true, waiverId: 'waiver-1' },
    code: 'REQUIREMENT_WAIVED',
    evidenceRefs: ['waiver:1'],
  }), false);
});

test('non-waivable or incomplete requirement remains blocking', () => {
  assert.equal(isWorkflowRequirementBlocking({
    requirementKey: 'legal-invariant',
    state: 'WAIVED',
    waiver: { allowed: false, applied: true, waiverId: 'invalid-waiver' },
    code: 'REQUIREMENT_NON_WAIVABLE',
    evidenceRefs: [],
  }), true);

  assert.equal(isWorkflowRequirementBlocking({
    requirementKey: 'identity-check',
    state: 'PENDING',
    waiver: { allowed: false, applied: false },
    code: 'REQUIREMENT_PENDING',
    evidenceRefs: [],
  }), true);
});
