import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasDraftWorkflowEditorErrors,
  validateDraftWorkflowEditorState,
} from '../app/(shell)/configuration/industry-packs/drafts/[verticalKey]/[version]/draft-editor-model';

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
