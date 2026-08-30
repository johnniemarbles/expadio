import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DENTEX_TREATMENT_ATTRIBUTE_KEYS,
  DENTEX_TREATMENT_URGENCIES,
  DENTEX_TREATMENT_WORK_TYPE_KEY,
  type DentexTreatment,
} from '../src/index.ts';
import {
  DENTEX_PACK,
  resolveCaseOntology,
  resolveCaseSchema,
} from '../../../packages/industry-packs/src/index.ts';

test('Treatment contract stays aligned with the DENTEX Industry Pack', () => {
  const schema = resolveCaseSchema(DENTEX_PACK);
  const ontology = resolveCaseOntology(DENTEX_PACK);

  assert.equal(DENTEX_TREATMENT_WORK_TYPE_KEY, 'crm.case');
  assert.equal(ontology.entity, 'Treatment');
  assert.deepEqual(
    schema.fields.map((field) => field.key),
    [...DENTEX_TREATMENT_ATTRIBUTE_KEYS],
  );
  assert.deepEqual(
    schema.fields.find((field) => field.key === 'urgency')?.options,
    [...DENTEX_TREATMENT_URGENCIES],
  );
  assert.deepEqual(
    ontology.relationships.map((relationship) => relationship.conceptKey),
    ['crm.account', 'crm.contact', 'crm.agreement'],
  );
});

test('Treatment remains a typed projection over canonical CRM identities', () => {
  const treatment: DentexTreatment = {
    treatmentId: '11111111-1111-1111-1111-111111111111',
    tenantId: '22222222-2222-2222-2222-222222222222',
    practiceId: '33333333-3333-3333-3333-333333333333',
    patientId: '44444444-4444-4444-4444-444444444444',
    carePlanAgreementId: null,
    subject: 'Root canal treatment',
    description: null,
    priority: 'NORMAL',
    status: 'OPEN',
    stage: 'INTAKE',
    schemaVersion: 1,
    attributes: {
      urgency: 'Priority',
      tooth: 'UR6',
      procedureCode: 'RCT',
    },
  };

  assert.equal(treatment.attributes.urgency, 'Priority');
  assert.equal(treatment.practiceId.startsWith('3333'), true);
  assert.equal(treatment.patientId.startsWith('4444'), true);
});
