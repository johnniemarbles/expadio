import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDraftCaseSchemaEditorState,
  caseSchemaFieldKeys,
  draftCaseSchemaStateFromDefinition,
  hasDraftCaseSchemaEditorErrors,
  validateDraftCaseSchemaEditorState,
} from '../app/(shell)/configuration/industry-packs/drafts/[verticalKey]/[version]/case-schema-editor-model.ts';

const valid = {
  version: 2,
  fields: [
    {
      key: 'clinicCode',
      label: 'Clinic code',
      type: 'text',
      required: true,
      options: [],
    },
    {
      key: 'urgency',
      label: 'Urgency',
      type: 'select',
      required: false,
      options: ['Routine', 'Priority'],
    },
  ],
};

test('case schema editor validates supported field definitions', () => {
  const errors = validateDraftCaseSchemaEditorState(valid);
  assert.equal(hasDraftCaseSchemaEditorErrors(errors), false);
  assert.deepEqual(errors, {});
  assert.deepEqual(caseSchemaFieldKeys(valid), ['clinicCode', 'urgency']);
});

test('case schema editor rejects invalid version, duplicate keys, invalid types and option shapes', () => {
  const errors = validateDraftCaseSchemaEditorState({
    version: 0,
    fields: [
      {
        key: 'bad key',
        label: ' ',
        type: 'date',
        required: false,
        options: [],
      },
      {
        key: 'clinicCode',
        label: 'Clinic code',
        type: 'select',
        required: false,
        options: [],
      },
      {
        key: 'clinicCode',
        label: 'Duplicate clinic code',
        type: 'text',
        required: false,
        options: ['not allowed'],
      },
    ],
  });

  assert.equal(hasDraftCaseSchemaEditorErrors(errors), true);
  assert.ok(errors.version);
  assert.ok(errors.fields?.[0]?.key);
  assert.ok(errors.fields?.[0]?.label);
  assert.ok(errors.fields?.[0]?.type);
  assert.ok(errors.fields?.[1]?.options);
  assert.ok(errors.fields?.[2]?.key);
  assert.ok(errors.fields?.[2]?.options);
});

test('case schema editor round-trips schema while preserving unrelated Pack sections', () => {
  const terminology = { keep: true };
  const definition = {
    verticalKey: 'dentex',
    terminology,
    caseSchema: {
      version: 1,
      fields: [{
        key: 'procedureCode',
        label: 'Procedure code',
        type: 'text',
      }],
    },
    caseStageSemantics: {
      requirements: [{
        stageKey: 'IN_PROGRESS',
        phase: 'EXIT' as const,
        requiredAttributeKeys: ['procedureCode'],
        message: 'Procedure required.',
      }],
    },
  };

  const initial = draftCaseSchemaStateFromDefinition(definition);
  assert.equal(initial.version, 1);
  assert.equal(initial.fields[0]?.key, 'procedureCode');

  const merged = applyDraftCaseSchemaEditorState(definition, {
    version: 2,
    fields: [{
      key: ' clinicCode ',
      label: ' Clinic code ',
      type: 'text',
      required: true,
      options: [],
    }, {
      key: 'urgency',
      label: 'Urgency',
      type: 'select',
      required: false,
      options: [' Routine ', ' Priority '],
    }],
  });

  assert.strictEqual(merged.terminology, terminology);
  assert.strictEqual(merged.caseStageSemantics, definition.caseStageSemantics);
  assert.deepEqual(merged.caseSchema, {
    version: 2,
    fields: [{
      key: 'clinicCode',
      label: 'Clinic code',
      type: 'text',
      required: true,
    }, {
      key: 'urgency',
      label: 'Urgency',
      type: 'select',
      options: ['Routine', 'Priority'],
    }],
  });
});

test('case schema editor initializes an absent schema as version one with no fields', () => {
  assert.deepEqual(draftCaseSchemaStateFromDefinition({}), {
    version: 1,
    fields: [],
  });
});
