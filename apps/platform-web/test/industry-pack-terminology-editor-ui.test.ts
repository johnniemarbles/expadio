import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const editor = readFileSync(
  new URL('../app/(shell)/configuration/industry-packs/drafts/[verticalKey]/[version]/DraftWorkflowEditor.tsx', import.meta.url),
  'utf8',
);

test('draft editor exposes terminology controls while keeping canonical concept identity read-only', () => {
  assert.match(editor, /Industry terminology/);
  assert.match(editor, /Canonical concept key — stable and not editable/);
  assert.match(editor, /Aliases \(comma separated\)/);
  assert.match(editor, /Add locale label/);
  assert.match(editor, /Remove locale/);
  assert.doesNotMatch(editor, /onChange=.*conceptKey/);
});

test('terminology participates in the same validation and optimistic save transaction', () => {
  assert.match(editor, /validateDraftTerminologyEditorState\(terminologyState, state\.defaultLocale\)/);
  assert.match(editor, /hasDraftTerminologyEditorErrors\(terminologyErrors\)/);
  assert.match(
    editor,
    /applyDraftCaseSemanticsEditorState\([\s\S]*applyDraftCaseSchemaEditorState\([\s\S]*applyDraftTerminologyEditorState\([\s\S]*applyDraftWorkflowEditorState/,
  );
  assert.match(editor, /expectedRevision: revision/);
});

test('terminology editor remains vertical-neutral', () => {
  assert.doesNotMatch(editor, /dentex\.|verticalKey === ['"]dentex['"]/);
});
