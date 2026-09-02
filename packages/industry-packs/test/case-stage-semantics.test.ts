import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACME_CORP_PACK,
  resolveCaseSchema,
  resolveCaseStageSemantics,
  type CaseRelationshipConcept,
} from '../src/index.ts';

test('ACME Corp declares domain semantics over canonical case stages', () => {
  const semantics = resolveCaseStageSemantics(ACME_CORP_PACK);

  assert.deepEqual(semantics.requirements, [
    {
      stageKey: 'INTAKE',
      phase: 'EXIT',
      requiredRelationships: ['crm.contact', 'crm.account'],
      message: 'A contact and client must be linked before work begins.',
    },
    {
      stageKey: 'IN_PROGRESS',
      phase: 'EXIT',
      requiredAttributeKeys: ['serviceType'],
      message: 'Record the service type before quality review.',
    },
    {
      stageKey: 'REVIEW',
      phase: 'EXIT',
      requiredRelationships: ['crm.agreement'],
      requiredDecisionOutcomes: ['APPROVE'],
      message: 'Senior approval and a service agreement are required before closing.',
    },
  ]);
});

test('ACME Corp semantic attribute requirements reference declared schema fields', () => {
  const fieldKeys = new Set(resolveCaseSchema(ACME_CORP_PACK).fields.map((field) => field.key));
  const requiredKeys = resolveCaseStageSemantics(ACME_CORP_PACK).requirements
    .flatMap((requirement) => requirement.requiredAttributeKeys ?? []);

  for (const key of requiredKeys) assert.equal(fieldKeys.has(key), true, key);
});

test('ACME Corp semantic relationships remain canonical CRM concepts', () => {
  const allowed = new Set<CaseRelationshipConcept>(['crm.account', 'crm.contact', 'crm.agreement']);
  const relationships = resolveCaseStageSemantics(ACME_CORP_PACK).requirements
    .flatMap((requirement) => requirement.requiredRelationships ?? []);

  for (const concept of relationships) assert.equal(allowed.has(concept), true, concept);
});

test('neutral engine has no vertical stage semantics', () => {
  assert.deepEqual(resolveCaseStageSemantics(null), { requirements: [] });
});
