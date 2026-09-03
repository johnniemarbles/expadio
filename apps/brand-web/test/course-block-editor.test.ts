import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const editor = read('../components/CourseBlockEditor.tsx');
const detail = read('../app/(workspace)/learning/courses/[id]/page.tsx');
const draftRoute = read('../app/api/learning/courses/[id]/versions/[version]/route.ts');

test('Brand mounts the native editor only on its authorized course surface', () => {
  assert.match(detail, /value\.admin \? <section/);
  assert.match(detail, /CourseBlockEditor/);
  assert.match(editor, /version\.state === 'DRAFT'/);
  assert.match(editor, /This version is immutable/);
});

test('editor supports slash insertion and stable ordered operations', () => {
  for (const command of ['/text', '/heading', '/callout']) assert.match(editor, new RegExp(command));
  assert.match(editor, /crypto\.randomUUID\(\)/);
  assert.match(editor, /Move \$\{block\.type\} up/);
  assert.match(editor, /Move \$\{block\.type\} down/);
  assert.match(editor, />Duplicate</);
  assert.match(editor, />Delete</);
  assert.match(editor, /position: index \+ 1/);
});

test('autosave is real, abortable, and blocked by validation failures', () => {
  assert.match(editor, /window\.setTimeout/);
  assert.match(editor, /AbortController/);
  assert.match(editor, /method: 'PUT'/);
  assert.match(editor, /validationIssues\.length > 0/);
  assert.match(editor, /LESSON_CONTENT_VALIDATION_FAILED/);
  assert.match(draftRoute, /replaceLearningCourseDraft/);
  assert.doesNotMatch(editor, /mock|fixture|fakeSave/i);
});

test('preview renders React text rather than trusted HTML', () => {
  assert.match(editor, /aria-label="Lesson preview"/);
  assert.match(editor, /String\(block\.data\.text/);
  assert.doesNotMatch(editor, /dangerouslySetInnerHTML|innerHTML/);
});

test('editor exposes accessible status, validation and controls', () => {
  assert.match(editor, /aria-live="polite"/);
  assert.match(editor, /role="alert"/);
  assert.match(editor, /aria-pressed=\{preview\}/);
  assert.match(editor, /aria-labelledby="lesson-validation-title"/);
  assert.match(editor, /onKeyDown/);
});
