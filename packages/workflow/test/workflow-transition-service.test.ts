import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowTransitionServiceResult } from '../src/workflow-transition-service.ts';

test('transition service result is explicitly discriminated for blocked and persistence failures', () => {
  const blocked: WorkflowTransitionServiceResult = {
    status: 'BLOCKED',
    gate: {
      allowed: false,
      blockers: [{ kind: 'REQUIREMENT', code: 'REQUIREMENT_PENDING', key: 'identity-check' }],
      trace: ['route:next-stage', 'requirement:identity-check:REQUIREMENT_PENDING'],
    },
  };
  const conflict: WorkflowTransitionServiceResult = { status: 'REVISION_CONFLICT' };
  const invalid: WorkflowTransitionServiceResult = {
    status: 'INVALID',
    code: 'WORKFLOW_TARGET_STAGE_NOT_FOUND',
  };

  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(conflict.status, 'REVISION_CONFLICT');
  assert.equal(invalid.code, 'WORKFLOW_TARGET_STAGE_NOT_FOUND');
});
