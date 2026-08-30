import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDraftWorkflowEditorState,
  hasDraftWorkflowEditorErrors,
  validateDraftWorkflowEditorState,
} from '../app/(shell)/configuration/industry-packs/drafts/[verticalKey]/[version]/draft-editor-model.ts';

const valid = {
  label: 'DENTEX — Dental practice',
  defaultLocale: 'en',
  workType: 'Treatment',
  stages: [
    { key: 'INTAKE', label: 'Consultation', guidance: 'Assess the patient.' },
    { key: 'IN_PROGRESS', label: 'In treatment', guidance: 'Perform care.' },
  ],
};

test('draft editor validation accepts a complete workflow vocabulary', () => {
  const errors = validateDraftWorkflowEditorState(valid);
  assert.equal(hasDraftWorkflowEditorErrors(errors), false);
  assert.deepEqual(errors, {});
});

test('draft editor validation fails closed on required blank authoring fields', () => {
  const errors = validateDraftWorkflowEditorState({
    ...valid,
    label: ' ',
    defaultLocale: '',
    workType: ' ',
    stages: [{ key: 'INTAKE', label: '', guidance: '' }],
  });
  assert.equal(hasDraftWorkflowEditorErrors(errors), true);
  assert.equal(errors.label, 'Pack label is required.');
  assert.equal(errors.defaultLocale, 'Default locale is required.');
  assert.equal(errors.workType, 'Workflow name is required.');
  assert.equal(errors.stages?.INTAKE?.label, 'Stage label is required.');
});

test('draft editor merge changes only the exposed workflow fields', () => {
  const profile = {
    industryKey: 'dental',
    label: 'Dental',
    components: [{ kind: 'VERTICAL', key: 'dentex', version: 1 }],
  };
  const caseSchema = {
    version: 3,
    fields: [{ key: 'procedureCode', label: 'Procedure', type: 'TEXT', required: true }],
  };
  const ontology = { CLIENT: 'Patient', ORGANIZATION: 'Practice' };
  const definition = {
    verticalKey: 'dentex',
    label: 'Original',
    profile,
    terminology: {
      defaultLocale: 'en',
      concepts: [{ conceptKey: 'CLIENT', labels: [{ locale: 'en', singular: 'Patient', plural: 'Patients' }] }],
    },
    caseWorkflow: {
      workType: 'Case',
      stages: { INTAKE: 'Intake', IN_PROGRESS: 'Working' },
      decisionOutcomeLabels: { APPROVE: 'Approve' },
      stageGuidance: { INTAKE: 'Old guidance' },
    },
    caseSchema,
    caseOntologyRoles: ontology,
  };

  const merged = applyDraftWorkflowEditorState(definition, {
    label: ' Updated Pack ',
    defaultLocale: ' en-CA ',
    workType: ' Treatment ',
    stages: [
      { key: 'INTAKE', label: ' Consultation ', guidance: ' Assess patient ' },
      { key: 'IN_PROGRESS', label: ' In treatment ', guidance: '' },
    ],
  });

  assert.equal(merged.label, 'Updated Pack');
  assert.equal(merged.terminology.defaultLocale, 'en-CA');
  assert.equal(merged.caseWorkflow?.workType, 'Treatment');
  assert.deepEqual(merged.caseWorkflow?.stages, {
    INTAKE: 'Consultation',
    IN_PROGRESS: 'In treatment',
  });
  assert.deepEqual(merged.caseWorkflow?.stageGuidance, {
    INTAKE: 'Assess patient',
  });
  assert.deepEqual(merged.caseWorkflow?.decisionOutcomeLabels, { APPROVE: 'Approve' });
  assert.strictEqual(merged.profile, profile);
  assert.strictEqual(merged.caseSchema, caseSchema);
  assert.strictEqual(merged.caseOntologyRoles, ontology);
});
