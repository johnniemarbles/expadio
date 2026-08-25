import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowedWorkflowGateDecision,
  blockedWorkflowGateDecision,
} from '../src/workflow-gate.ts';

test('allowed gate decision contains no blockers and preserves trace', () => {
  assert.deepEqual(allowedWorkflowGateDecision(['route', 'requirements']), {
    allowed: true,
    blockers: [],
    trace: ['route', 'requirements'],
  });
});

test('blocked gate decision preserves structured blocker evidence', () => {
  assert.deepEqual(blockedWorkflowGateDecision({
    blockers: [
      {
        kind: 'REQUIREMENT',
        code: 'REQUIREMENT_INCOMPLETE',
        key: 'identity-check',
      },
    ],
    trace: ['route:allowed', 'requirement:identity-check:blocked'],
  }), {
    allowed: false,
    blockers: [
      {
        kind: 'REQUIREMENT',
        code: 'REQUIREMENT_INCOMPLETE',
        key: 'identity-check',
      },
    ],
    trace: ['route:allowed', 'requirement:identity-check:blocked'],
  });
});

test('blocked gate decision rejects an empty blocker set', () => {
  assert.throws(
    () => blockedWorkflowGateDecision({ blockers: [] }),
    /WORKFLOW_GATE_BLOCKERS_REQUIRED/,
  );
});
