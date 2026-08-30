import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const editor = readFileSync(
  new URL('../app/(shell)/configuration/industry-packs/drafts/[verticalKey]/[version]/DraftWorkflowEditor.tsx', import.meta.url),
  'utf8',
);

test('draft editor exposes structured case-schema authoring controls', () => {
  assert.match(editor, /Case schema/);
  assert.match(editor, /Add case field/);
  assert.match(editor, /Schema version/);
  assert.match(editor, /Field key/);
  assert.match(editor, /Options \(comma separated\)/);
  assert.match(editor, /Remove field/);
});

test('case schema and executable semantics share one validation and save transaction', () => {
  assert.match(editor, /caseSchemaFieldKeys\(schemaState\)/);
  assert.match(editor, /validateDraftCaseSemanticsEditorState\(semanticState, availableAttributeKeys\)/);
  assert.match(editor, /hasDraftCaseSchemaEditorErrors\(schemaErrors\)/);
  assert.match(
    editor,
    /applyDraftCaseSemanticsEditorState\([\s\S]*applyDraftCaseSchemaEditorState\([\s\S]*applyDraftWorkflowEditorState/,
  );
  assert.match(editor, /expectedRevision: revision/);
});

test('case schema editor remains Pack-neutral', () => {
  assert.doesNotMatch(editor, /dentex\.|verticalKey === ['"]dentex['"]/);
});
