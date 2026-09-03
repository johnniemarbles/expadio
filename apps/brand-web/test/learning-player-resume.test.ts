import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const player = read('../app/(workspace)/learn/[id]/page.tsx');
const resume = read('../app/api/learning/progress/resume/route.ts');
const complete = read('../app/api/learning/progress/complete/route.ts');
const runtime = read('../../../packages/postgres-runtime/src/learning-enrollment.ts');
const migration = read('../../../infra/db/migrations/0139_learning_player_resume.sql');

test('player renders canonical blocks without raw JSON or trusted HTML', () => {
  assert.match(player, /content\.schemaVersion === 1/);
  for (const type of ['HEADING', 'CALLOUT', 'RICH_TEXT', 'CODE', 'DISCUSSION_PROMPT']) {
    assert.match(player, new RegExp(type));
  }
  assert.doesNotMatch(player, /JSON\.stringify\(content/);
  assert.doesNotMatch(player, /dangerouslySetInnerHTML|innerHTML/);
});

test('required lesson sequence is calculated and enforced in runtime', () => {
  assert.match(runtime, /blockingRequiredLessonId/);
  assert.match(runtime, /unlocked: blockedByLessonId === null/);
  assert.match(runtime, /LEARNING_LESSON_LOCKED/);
  assert.match(runtime, /\(prior_module\.position, prior\.position\) < \(target_module\.position, target\.position\)/);
  assert.match(complete, /LEARNING_LESSON_LOCKED/);
  assert.match(player, /Complete the earlier required lesson to unlock/);
});

test('resume is authenticated, RLS-transactional and server persisted', () => {
  assert.match(resume, /resolveBrandContext/);
  assert.match(resume, /withBrandTransaction/);
  assert.match(resume, /recordMyLearningLessonResume/);
  assert.match(runtime, /resume_block_id = EXCLUDED\.resume_block_id/);
  assert.match(runtime, /last_viewed_at = now\(\)/);
  assert.match(migration, /resume_block_id text/);
  assert.match(migration, /resume_position integer/);
  assert.match(migration, /last_viewed_at timestamptz/);
});

test('player exposes honest start and continue actions from persisted state', () => {
  assert.match(player, /state\?\.resumeBlockId \? 'Continue lesson' : 'Start lesson'/);
  assert.match(player, /ResumeLessonButton/);
  assert.doesNotMatch(player, /setTimeout|fakeProgress|mock/i);
});
