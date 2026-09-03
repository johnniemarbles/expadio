import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDraftDecisionOutcomeLabelsEditorState,
  draftDecisionOutcomeLabelsStateFromDefinition,
  hasDraftDecisionOutcomeLabelErrors,
  validateDraftDecisionOutcomeLabelsEditorState,
} from '../app/(shell)/configuration/industry-packs/drafts/[verticalKey]/[version]/decision-outcome-label-editor-model.ts';

test('decision-outcome editor initializes existing labels deterministically', () => {
  const state = draftDecisionOutcomeLabelsStateFromDefinition({
    caseWorkflow: {
      decisionOutcomeLabels: {
        RETURN: 'Send back for revision',
        APPROVE: 'Approve treatment plan',
      },
    },
  });

  assert.deepEqual(state.labels, [
    { outcomeKey: 'APPROVE', label: 'Approve treatment plan' },
    { outcomeKey: 'RETURN', label: 'Send back for revision' },
  ]);
});

test('decision-outcome editor validates unique trimmed keys and non-empty labels', () => {
  const valid = validateDraftDecisionOutcomeLabelsEditorState({
    labels: [
      { outcomeKey: 'APPROVE', label: 'Approve treatment plan' },
      { outcomeKey: 'RETURN', label: 'Return for revision' },
    ],
  });
  assert.equal(hasDraftDecisionOutcomeLabelErrors(valid), false);

  const invalid = validateDraftDecisionOutcomeLabelsEditorState({
    labels: [
      { outcomeKey: ' APPROVE ', label: 'Approve' },
      { outcomeKey: 'RETURN', label: ' ' },
      { outcomeKey: 'RETURN', label: 'Duplicate key' },
    ],
  });
  assert.equal(hasDraftDecisionOutcomeLabelErrors(invalid), true);
  assert.ok(invalid.labels?.[0]?.outcomeKey);
  assert.ok(invalid.labels?.[1]?.label);
  assert.ok(invalid.labels?.[2]?.outcomeKey);
});

test('decision-outcome editor replaces labels while preserving unrelated workflow fields', () => {
  const stages = { INTAKE: 'Consultation', REVIEW: 'Clinical review' };
  const stageGuidance = { REVIEW: 'Clinician sign-off.' };
  const definition = {
    label: 'DENTEX',
    caseWorkflow: {
      workType: 'Treatment',
      stages,
      stageGuidance,
      decisionOutcomeLabels: { APPROVE: 'Old label' },
    },
  };

  const merged = applyDraftDecisionOutcomeLabelsEditorState(definition, {
    labels: [
      { outcomeKey: 'APPROVE', label: 'Approve treatment plan' },
      { outcomeKey: 'RETURN', label: 'Send back for revision' },
    ],
  });

  assert.strictEqual(merged.caseWorkflow?.stages, stages);
  assert.strictEqual(merged.caseWorkflow?.stageGuidance, stageGuidance);
  assert.deepEqual(merged.caseWorkflow?.decisionOutcomeLabels, {
    APPROVE: 'Approve treatment plan',
    RETURN: 'Send back for revision',
  });
});

test('clearing all decision-outcome labels removes only the optional override map', () => {
  const definition = {
    caseWorkflow: {
      workType: 'Case',
      stages: { INTAKE: 'Intake' },
      decisionOutcomeLabels: { APPROVE: 'Approve' },
    },
  };

  const merged = applyDraftDecisionOutcomeLabelsEditorState(definition, { labels: [] });

  assert.equal('decisionOutcomeLabels' in (merged.caseWorkflow ?? {}), false);
  assert.equal(merged.caseWorkflow?.workType, 'Case');
});

test('empty labels do not invent a caseWorkflow section when none exists', () => {
  const definition = { label: 'Neutral Pack' };
  const merged = applyDraftDecisionOutcomeLabelsEditorState(definition, { labels: [] });

  assert.strictEqual(merged, definition);
  assert.equal('caseWorkflow' in merged, false);
});
