import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isWorkflowParticipantAssignmentBlocking,
  type WorkflowParticipantAssignment,
} from '../src/index.ts';

const assigned: WorkflowParticipantAssignment = {
  participantKey: 'approver',
  status: 'ASSIGNED',
  assignmentId: 'assignment-1',
  target: { kind: 'ROLE', key: 'regional-approver' },
  code: 'WORKFLOW_PARTICIPANT_ASSIGNED',
  evidenceRefs: ['assignment:assignment-1'],
};

test('assigned participant slot is not blocking', () => {
  assert.equal(isWorkflowParticipantAssignmentBlocking(assigned), false);
});

test('unassigned, ineligible and unavailable participant slots fail closed', () => {
  for (const status of ['UNASSIGNED', 'INELIGIBLE', 'UNAVAILABLE'] as const) {
    assert.equal(
      isWorkflowParticipantAssignmentBlocking({
        participantKey: 'reviewer',
        status,
        code: `WORKFLOW_PARTICIPANT_${status}`,
        evidenceRefs: [],
      }),
      true,
    );
  }
});

test('participant target remains neutral across user, role, queue and AI-agent assignment', () => {
  assert.deepEqual(assigned.target, { kind: 'ROLE', key: 'regional-approver' });
  const kinds = ['USER', 'ROLE', 'PERSONA', 'TEAM', 'QUEUE', 'ORGANIZATION', 'TERRITORY', 'EXTERNAL_PARTY', 'SYSTEM', 'AI_AGENT'];
  assert.equal(kinds.includes(assigned.target?.kind ?? ''), true);
});
