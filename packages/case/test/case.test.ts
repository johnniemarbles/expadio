import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCaseInput, validateCaseStatus, validateCasePriority, isClosedCase, CaseValidationError, CASE_STATUSES } from '../src/index.ts';

test('a valid case defaults priority/status and keeps subject', () => {
  const c = validateCaseInput({ subject: '  Login broken ' });
  assert.equal(c.subject, 'Login broken');
  assert.equal(c.priority, 'NORMAL');
  assert.equal(c.status, 'OPEN');
});

test('case subject is required and bounded', () => {
  assert.throws(() => validateCaseInput({ subject: '' }), CaseValidationError);
  assert.throws(() => validateCaseInput({ subject: 'x'.repeat(201) }), /1–200/);
});

test('priority and status must be known', () => {
  assert.throws(() => validateCaseInput({ subject: 'S', priority: 'MEGA' }), /priority/);
  assert.throws(() => validateCaseInput({ subject: 'S', status: 'PARKED' }), /status/);
  assert.equal(validateCasePriority('high'), 'HIGH');
  for (const s of CASE_STATUSES) assert.equal(validateCaseStatus(s), s);
});

test('blueprintKey is a governed key when present', () => {
  assert.throws(() => validateCaseInput({ subject: 'S', blueprintKey: 'bad key!' }), /blueprintKey/);
  assert.equal(validateCaseInput({ subject: 'S', blueprintKey: 'support.case' }).blueprintKey, 'support.case');
});

test('closed-case rule', () => {
  assert.equal(isClosedCase('RESOLVED'), true);
  assert.equal(isClosedCase('CLOSED'), true);
  assert.equal(isClosedCase('OPEN'), false);
});

test('accountId/contactId must be uuids when present', () => {
  assert.throws(() => validateCaseInput({ subject: 'S', accountId: 'x' }), /valid identifier/);
});
