import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const editor = readFileSync(
  new URL('../app/(shell)/configuration/industry-packs/drafts/[verticalKey]/[version]/DraftWorkflowEditor.tsx', import.meta.url),
  'utf8',
);

test('draft editor exposes relationship vocabulary controls over canonical CRM concepts', () => {
  assert.match(editor, /Relationship vocabulary/);
  assert.match(editor, /canonical CRM relationships/);
  assert.match(editor, /Leave blank to use the neutral fallback/);
  assert.match(editor, /ontologyRoleState\.roles\.map/);
  assert.doesNotMatch(editor, /onChange=.*conceptKey/);
});

test('relationship roles participate in the shared validation and optimistic save transaction', () => {
  assert.match(editor, /validateDraftOntologyRolesEditorState\(ontologyRoleState\)/);
  assert.match(editor, /hasDraftOntologyRoleErrors\(ontologyRoleErrors\)/);
  assert.match(
    editor,
    /applyDraftCaseSemanticsEditorState\([\s\S]*applyDraftCaseSchemaEditorState\([\s\S]*applyDraftOntologyRolesEditorState\([\s\S]*applyDraftTerminologyEditorState\([\s\S]*applyDraftWorkflowEditorState/,
  );
  assert.match(editor, /expectedRevision: revision/);
});

test('relationship vocabulary editor remains Industry Pack neutral', () => {
  assert.doesNotMatch(editor, /dentex\.|verticalKey === ['"]dentex['"]/);
});
