import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDraftCaseSemanticsEditorState,
  draftCaseSemanticsStateFromDefinition,
  hasDraftCaseSemanticsEditorErrors,
  validateDraftCaseSemanticsEditorState,
} from '../app/(shell)/configuration/industry-packs/drafts/[verticalKey]/[version]/case-semantics-editor-model.ts';

const valid = {
  rules: [{
    stageKey: 'REVIEW',
    phase: 'EXIT' as const,
    requiredAttributeKeys: ['procedureCode'],
    requiredRelationships: ['crm.agreement'],
    requiredDecisionOutcomes: ['APPROVE'],
    message: 'Approval and care plan are required.',
  }],
};

test('semantic editor validates canonical rules against the Pack schema', () => {
  const errors = validateDraftCaseSemanticsEditorState(valid, ['procedureCode']);
  assert.equal(hasDraftCaseSemanticsEditorErrors(errors), false);
  assert.deepEqual(errors, {});
});

test('semantic editor rejects undeclared attributes, vertical relationships, empty rules and messages', () => {
  const errors = validateDraftCaseSemanticsEditorState({
    rules: [{
      stageKey: 'REVIEW',
      phase: 'EXIT',
      requiredAttributeKeys: ['unknown'],
      requiredRelationships: ['dentex.patient'],
      requiredDecisionOutcomes: [],
      message: ' ',
    }, {
      stageKey: 'IN_PROGRESS',
      phase: 'EXIT',
      requiredAttributeKeys: [],
      requiredRelationships: [],
      requiredDecisionOutcomes: [],
      message: 'Nothing to enforce',
    }],
  }, ['procedureCode']);

  assert.equal(hasDraftCaseSemanticsEditorErrors(errors), true);
  assert.ok(errors.rules?.[0]?.requiredAttributeKeys);
  assert.ok(errors.rules?.[0]?.requiredRelationships);
  assert.ok(errors.rules?.[0]?.message);
  assert.ok(errors.rules?.[1]?.requirement);
});

test('semantic editor round-trips rules while preserving unrelated Pack sections', () => {
  const profile = { keep: true };
  const definition = {
    verticalKey: 'dentex',
    profile,
    caseSchema: { version: 1, fields: [{ key: 'procedureCode' }] },
    caseStageSemantics: {
      requirements: [{
        stageKey: 'INTAKE' as const,
        phase: 'EXIT' as const,
        requiredRelationships: ['crm.contact' as const],
        message: 'Patient required.',
      }],
    },
  };

  const initial = draftCaseSemanticsStateFromDefinition(definition);
  assert.equal(initial.rules[0]?.stageKey, 'INTAKE');

  const merged = applyDraftCaseSemanticsEditorState(definition, valid);
  assert.strictEqual(merged.profile, profile);
  assert.strictEqual(merged.caseSchema, definition.caseSchema);
  assert.deepEqual(merged.caseStageSemantics, {
    requirements: [{
      stageKey: 'REVIEW',
      phase: 'EXIT',
      requiredAttributeKeys: ['procedureCode'],
      requiredRelationships: ['crm.agreement'],
      requiredDecisionOutcomes: ['APPROVE'],
      message: 'Approval and care plan are required.',
    }],
  });
});
