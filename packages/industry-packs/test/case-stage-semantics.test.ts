import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DENTEX_PACK,
  resolveCaseSchema,
  resolveCaseStageSemantics,
  type CaseRelationshipConcept,
} from '../src/index.ts';

test('DENTEX declares domain semantics over canonical case stages', () => {
  const semantics = resolveCaseStageSemantics(DENTEX_PACK);

  assert.deepEqual(semantics.requirements, [
    {
      stageKey: 'INTAKE',
      phase: 'EXIT',
      requiredRelationships: ['crm.contact', 'crm.account'],
      message: 'A patient and practice must be linked before treatment begins.',
    },
    {
      stageKey: 'IN_PROGRESS',
      phase: 'EXIT',
      requiredAttributeKeys: ['procedureCode'],
      message: 'Record the performed procedure before clinical review.',
    },
    {
      stageKey: 'REVIEW',
      phase: 'EXIT',
      requiredRelationships: ['crm.agreement'],
      requiredDecisionOutcomes: ['APPROVE'],
      message: 'Clinical approval and a care plan are required before discharge.',
    },
  ]);
});

test('DENTEX semantic attribute requirements reference declared schema fields', () => {
  const fieldKeys = new Set(resolveCaseSchema(DENTEX_PACK).fields.map((field) => field.key));
  const requiredKeys = resolveCaseStageSemantics(DENTEX_PACK).requirements
    .flatMap((requirement) => requirement.requiredAttributeKeys ?? []);

  for (const key of requiredKeys) assert.equal(fieldKeys.has(key), true, key);
});

test('DENTEX semantic relationships remain canonical CRM concepts', () => {
  const allowed = new Set<CaseRelationshipConcept>(['crm.account', 'crm.contact', 'crm.agreement']);
  const relationships = resolveCaseStageSemantics(DENTEX_PACK).requirements
    .flatMap((requirement) => requirement.requiredRelationships ?? []);

  for (const concept of relationships) assert.equal(allowed.has(concept), true, concept);
});

test('neutral engine has no vertical stage semantics', () => {
  assert.deepEqual(resolveCaseStageSemantics(null), { requirements: [] });
});
