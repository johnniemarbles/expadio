import assert from 'node:assert/strict';
import test from 'node:test';
import {
  semanticKey,
  validateTerminologyPack,
  type TerminologyPack,
} from '../src/index.ts';

const pack: TerminologyPack = {
  packKey: 'dentex-en',
  version: 1,
  locale: 'en-CA',
  scope: { type: 'INDUSTRY', industryKey: 'DENTAL' },
  entries: [
    {
      semanticKey: semanticKey('PROVIDER'),
      singular: 'Dentist',
      plural: 'Dentists',
    },
    {
      semanticKey: semanticKey('CLIENT'),
      singular: 'Patient',
      plural: 'Patients',
    },
  ],
};

test('semantic keys are stable machine identifiers, not editable labels', () => {
  assert.equal(semanticKey(' PROVIDER '), 'PROVIDER');
  assert.equal(semanticKey('RELATIONSHIP.PROVIDER_OF'), 'RELATIONSHIP.PROVIDER_OF');
  assert.throws(() => semanticKey('Dentist'), /BUSINESS_CONFIG_SEMANTIC_KEY_INVALID/);
  assert.throws(() => semanticKey('provider'), /BUSINESS_CONFIG_SEMANTIC_KEY_INVALID/);
});

test('valid terminology pack maps labels to semantic keys without changing semantics', () => {
  assert.deepEqual(validateTerminologyPack(pack), { valid: true, issues: [] });
  assert.equal(pack.entries[0]?.semanticKey, 'PROVIDER');
  assert.equal(pack.entries[0]?.singular, 'Dentist');
});

test('terminology pack rejects duplicate semantic keys and invalid effective range', () => {
  const result = validateTerminologyPack({
    ...pack,
    effectiveFrom: '2026-08-25T10:00:00.000Z',
    effectiveUntil: '2026-08-25T09:00:00.000Z',
    entries: [pack.entries[0]!, { ...pack.entries[0]!, singular: 'Doctor' }],
  });

  assert.equal(result.valid, false);
  assert.deepEqual(
    result.issues.map((item) => item.code),
    ['TERMINOLOGY_SEMANTIC_KEY_DUPLICATE', 'TERMINOLOGY_EFFECTIVE_RANGE_INVALID'],
  );
});
