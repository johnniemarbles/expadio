import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateAgreementInput,
  validateAgreementStatus,
  isClosedStatus,
  AgreementValidationError,
  AGREEMENT_STATUSES,
} from '../src/index.ts';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';

test('a valid agreement normalizes and defaults', () => {
  const a = validateAgreementInput({ accountId: ACCOUNT, title: '  Annual plan  ' });
  assert.equal(a.accountId, ACCOUNT);
  assert.equal(a.title, 'Annual plan');
  assert.equal(a.status, 'DRAFT');
  assert.equal(a.currency, 'USD');
  assert.equal(a.valueMinorUnits, null);
  assert.equal(a.startsOn, null);
  assert.equal(a.endsOn, null);
  assert.equal(a.sourceLeadId, null);
});

test('an agreement requires a customer account', () => {
  assert.throws(() => validateAgreementInput({ title: 'x' }), (e: unknown) => {
    assert.ok(e instanceof AgreementValidationError);
    assert.equal((e as AgreementValidationError).field, 'accountId');
    return true;
  });
});

test('value must be a non-negative integer of minor units', () => {
  assert.throws(() => validateAgreementInput({ accountId: ACCOUNT, title: 'x', valueMinorUnits: -5 }));
  assert.throws(() => validateAgreementInput({ accountId: ACCOUNT, title: 'x', valueMinorUnits: 1.5 }));
  const ok = validateAgreementInput({ accountId: ACCOUNT, title: 'x', valueMinorUnits: 120000, currency: 'eur' });
  assert.equal(ok.valueMinorUnits, 120000);
  assert.equal(ok.currency, 'EUR');
});

test('dates are validated and end cannot precede start', () => {
  const ok = validateAgreementInput({ accountId: ACCOUNT, title: 'x', startsOn: '2026-01-01', endsOn: '2026-12-31T00:00:00Z' });
  assert.equal(ok.startsOn, '2026-01-01');
  assert.equal(ok.endsOn, '2026-12-31');
  assert.throws(() => validateAgreementInput({ accountId: ACCOUNT, title: 'x', startsOn: '2026-06-01', endsOn: '2026-01-01' }), (e: unknown) => {
    assert.equal((e as AgreementValidationError).field, 'endsOn');
    return true;
  });
  assert.throws(() => validateAgreementInput({ accountId: ACCOUNT, title: 'x', startsOn: 'someday' }));
});

test('status validation and closed-status rule', () => {
  assert.equal(validateAgreementStatus('active'), 'ACTIVE');
  assert.throws(() => validateAgreementStatus('PAUSED'));
  assert.equal(isClosedStatus('CANCELLED'), true);
  assert.equal(isClosedStatus('ACTIVE'), false);
  assert.deepEqual([...AGREEMENT_STATUSES], ['DRAFT', 'ACTIVE', 'EXPIRED', 'CANCELLED']);
});
