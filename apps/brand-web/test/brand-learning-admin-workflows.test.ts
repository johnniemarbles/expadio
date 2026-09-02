import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Brand Learning operational sections use tenant-admin guarded write boundaries', () => {
  for (const route of [
    '../app/api/learning/assessments/route.ts',
    '../app/api/learning/programs/route.ts',
    '../app/api/learning/competency-frameworks/route.ts',
    '../app/api/learning/assignment-rules/route.ts',
    '../app/api/learning/question-banks/route.ts',
  ]) {
    const source = read(route);
    assert.match(source, /hasLearningAdmin/);
    assert.match(source, /withBrandTransaction/);
    assert.doesNotMatch(source, /tenant_module_entitlements.*INSERT|INSERT.*tenant_module_entitlements/s);
    assert.doesNotMatch(source, /platform-web/);
  }
});

test('Brand Learning section UI exposes real create workflows instead of read-only tables', () => {
  const page = read('../app/(workspace)/learning/[section]/page.tsx');
  const panel = read('../components/LearningSectionAdminPanel.tsx');

  assert.match(page, /LearningSectionAdminPanel/);
  assert.match(page, /hasLearningAdmin/);
  assert.match(panel, /\/api\/learning\/assessments/);
  assert.match(panel, /\/api\/learning\/programs/);
  assert.match(panel, /\/api\/learning\/competency-frameworks/);
  assert.match(panel, /\/api\/learning\/assignment-rules/);
  assert.match(panel, /\/api\/learning\/question-banks/);
  assert.match(panel, /Create assessment draft/);
  assert.match(panel, /Create program draft/);
  assert.match(panel, /Create competency framework/);
  assert.match(panel, /Create assignment rule/);
  assert.match(panel, /Create question bank/);
});

test('Assignment rules only target tenant-visible published course or program options', () => {
  const page = read('../app/(workspace)/learning/[section]/page.tsx');
  assert.match(page, /currentPublishedVersion !== null/);
  assert.match(page, /course\.status === 'ACTIVE'/);
  assert.match(page, /program\.status === 'ACTIVE'/);
});
