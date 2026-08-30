import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const editor = readFileSync(
  new URL('../app/(shell)/configuration/industry-packs/drafts/[verticalKey]/[version]/DraftWorkflowEditor.tsx', import.meta.url),
  'utf8',
);

test('draft editor exposes structured semantic controls and saves through the shared revision transaction', () => {
  assert.match(editor, /Executable stage semantics/);
  assert.match(editor, /Add semantic rule/);
  assert.match(editor, /Required case attributes/);
  assert.match(editor, /Required canonical relationships/);
  assert.match(editor, /Required decision outcomes/);
  assert.match(editor, /Blocking message/);
  assert.match(editor, /applyDraftCaseSemanticsEditorState\([\s\S]*applyDraftWorkflowEditorState/);
  assert.match(editor, /expectedRevision: revision/);
});

test('semantic editor uses canonical relationship vocabulary without vertical branches', () => {
  assert.match(editor, /CASE_RELATIONSHIP_CONCEPTS\.map/);
  assert.doesNotMatch(editor, /dentex\.patient|verticalKey === ['"]dentex['"]/);
});
