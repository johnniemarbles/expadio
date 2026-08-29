import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DENTEX_PACK,
  validateIndustryPackDefinition,
} from '../src/index.ts';

test('accepts a structurally valid Pack and normalizes its vertical key', () => {
  const result = validateIndustryPackDefinition(
    { ...DENTEX_PACK, verticalKey: ' DENTEX ' },
    'dentex',
  );
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.definition.verticalKey, 'dentex');
    assert.equal(result.definition.profile.industryKey, 'dentex');
  }
});

test('rejects a Pack whose vertical identity does not match the requested family', () => {
  const result = validateIndustryPackDefinition(DENTEX_PACK, 'lexflow');
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some((issue) => issue.code === 'PACK_VERTICAL_KEY_MISMATCH'));
  }
});

test('rejects a Pack whose profile identity differs from its vertical identity', () => {
  const result = validateIndustryPackDefinition({
    ...DENTEX_PACK,
    profile: { ...DENTEX_PACK.profile, industryKey: 'other' },
  });
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some(
      (issue) => issue.code === 'PACK_PROFILE_INVALID'
        && issue.detail === 'INDUSTRY_KEY_MUST_MATCH_VERTICAL_KEY',
    ));
  }
});

test('rejects malformed domain schema before authoring persistence', () => {
  const result = validateIndustryPackDefinition({
    ...DENTEX_PACK,
    caseSchema: {
      version: 1,
      fields: [
        { key: 'urgency', label: 'Urgency', type: 'select', options: [] },
      ],
    },
  });
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some((issue) => issue.code === 'PACK_CASE_SCHEMA_INVALID'));
  }
});

test('rejects non-object HTTP input without throwing', () => {
  assert.deepEqual(validateIndustryPackDefinition(null), {
    valid: false,
    issues: [{ code: 'PACK_OBJECT_REQUIRED', path: '' }],
  });
});
