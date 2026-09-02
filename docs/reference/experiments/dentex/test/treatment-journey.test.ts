import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateDentexTreatmentStageExit,
  validateDentexTreatmentAttributes,
} from '../src/index.ts';

test('DENTEX consultation requires patient + practice before treatment starts', () => {
  const blocked = evaluateDentexTreatmentStageExit({
    stage: 'INTAKE',
    attributes: { urgency: 'Routine' },
    patientLinked: true,
    practiceLinked: false,
    carePlanLinked: false,
    decisionOutcomes: [],
  });

  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.blockers.map((item) => item.key), ['crm.account']);

  const ready = evaluateDentexTreatmentStageExit({
    stage: 'INTAKE',
    attributes: { urgency: 'Routine' },
    patientLinked: true,
    practiceLinked: true,
    carePlanLinked: false,
    decisionOutcomes: [],
  });

  assert.equal(ready.ok, true);
});

test('DENTEX in-treatment exit requires the performed procedure', () => {
  const blocked = evaluateDentexTreatmentStageExit({
    stage: 'IN_PROGRESS',
    attributes: { urgency: 'Priority' },
    patientLinked: true,
    practiceLinked: true,
    carePlanLinked: false,
    decisionOutcomes: [],
  });

  assert.equal(blocked.ok, false);
  assert.equal(blocked.blockers[0]?.key, 'procedureCode');

  const ready = evaluateDentexTreatmentStageExit({
    stage: 'IN_PROGRESS',
    attributes: { urgency: 'Priority', procedureCode: 'D2740' },
    patientLinked: true,
    practiceLinked: true,
    carePlanLinked: false,
    decisionOutcomes: [],
  });

  assert.equal(ready.ok, true);
});

test('DENTEX clinical review requires care plan + clinician approval before discharge', () => {
  const blocked = evaluateDentexTreatmentStageExit({
    stage: 'REVIEW',
    attributes: { urgency: 'Routine', procedureCode: 'D1110' },
    patientLinked: true,
    practiceLinked: true,
    carePlanLinked: false,
    decisionOutcomes: [],
  });

  assert.equal(blocked.ok, false);
  assert.deepEqual(
    blocked.blockers.map((item) => item.code).sort(),
    ['CASE_SEMANTIC_DECISION_OUTCOME_REQUIRED', 'CASE_SEMANTIC_RELATIONSHIP_REQUIRED'].sort(),
  );

  const ready = evaluateDentexTreatmentStageExit({
    stage: 'REVIEW',
    attributes: { urgency: 'Routine', procedureCode: 'D1110' },
    patientLinked: true,
    practiceLinked: true,
    carePlanLinked: true,
    decisionOutcomes: ['APPROVE'],
  });

  assert.equal(ready.ok, true);
});

test('DENTEX treatment attributes enforce the governed vertical schema', () => {
  const invalid = validateDentexTreatmentAttributes({
    tooth: ' UR6 ',
    urgency: 'Whenever',
    extra: 'drop-me',
  });

  assert.equal(invalid.ok, false);
  assert.equal(invalid.schemaVersion, 1);
  assert.match(invalid.errors.join(' '), /Urgency must be one of/);

  const valid = validateDentexTreatmentAttributes({
    tooth: ' UR6 ',
    urgency: 'Emergency',
    procedureCode: ' D7140 ',
    extra: 'drop-me',
  });

  assert.equal(valid.ok, true);
  assert.deepEqual(valid.attributes, {
    tooth: 'UR6',
    procedureCode: 'D7140',
    urgency: 'Emergency',
  });
  assert.equal(valid.schemaVersion, 1);
});
