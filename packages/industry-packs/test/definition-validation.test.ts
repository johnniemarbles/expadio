import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACME_CORP_PACK,
  validateIndustryPackDefinition,
} from '../src/index.ts';

test('accepts a structurally valid Pack and normalizes its vertical key', () => {
  const result = validateIndustryPackDefinition(
    { ...ACME_CORP_PACK, verticalKey: ' ACME-CORP ' },
    'acme-corp',
  );
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.definition.verticalKey, 'acme-corp');
    assert.equal(result.definition.profile.industryKey, 'acme-corp');
  }
});

test('rejects a Pack whose vertical identity does not match the requested family', () => {
  const result = validateIndustryPackDefinition(ACME_CORP_PACK, 'lexflow');
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some((issue) => issue.code === 'PACK_VERTICAL_KEY_MISMATCH'));
  }
});

test('rejects a Pack whose profile identity differs from its vertical identity', () => {
  const result = validateIndustryPackDefinition({
    ...ACME_CORP_PACK,
    profile: { ...ACME_CORP_PACK.profile, industryKey: 'other' },
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
    ...ACME_CORP_PACK,
    caseSchema: {
      version: 1,
      fields: [
        { key: 'priority', label: 'Priority', type: 'select', options: [] },
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


test('preserves valid executable case-stage semantics through definition validation', () => {
  const result = validateIndustryPackDefinition(ACME_CORP_PACK, 'acme-corp');
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.deepEqual(result.definition.caseStageSemantics, ACME_CORP_PACK.caseStageSemantics);
  }
});

test('rejects semantic rules with a non-canonical case stage', () => {
  const result = validateIndustryPackDefinition({
    ...ACME_CORP_PACK,
    caseStageSemantics: {
      requirements: [{
        stageKey: 'DISCHARGE',
        phase: 'EXIT',
        requiredRelationships: ['crm.contact'],
        message: 'Invalid stage.',
      }],
    },
  });
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some((issue) => issue.code === 'PACK_CASE_STAGE_SEMANTICS_INVALID'));
  }
});

test('rejects semantic attributes that are not declared by the Pack case schema', () => {
  const result = validateIndustryPackDefinition({
    ...ACME_CORP_PACK,
    caseStageSemantics: {
      requirements: [{
        stageKey: 'IN_PROGRESS',
        phase: 'EXIT',
        requiredAttributeKeys: ['undeclaredClinicalField'],
        message: 'A missing schema field must not become executable policy.',
      }],
    },
  });
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some((issue) => issue.code === 'PACK_CASE_STAGE_SEMANTICS_INVALID'));
  }
});

test('rejects non-canonical semantic relationships and empty rules', () => {
  const invalidRelationship = validateIndustryPackDefinition({
    ...ACME_CORP_PACK,
    caseStageSemantics: {
      requirements: [{
        stageKey: 'INTAKE',
        phase: 'EXIT',
        requiredRelationships: ['dentex.patient'],
        message: 'Vertical relationship keys cannot enter the canonical evaluator.',
      }],
    },
  });
  assert.equal(invalidRelationship.valid, false);

  const emptyRule = validateIndustryPackDefinition({
    ...ACME_CORP_PACK,
    caseStageSemantics: {
      requirements: [{
        stageKey: 'INTAKE',
        phase: 'EXIT',
        message: 'A rule must constrain at least one canonical fact.',
      }],
    },
  });
  assert.equal(emptyRule.valid, false);
});
