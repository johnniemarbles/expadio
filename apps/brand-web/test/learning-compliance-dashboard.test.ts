import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../app/(workspace)/learning/compliance/page.tsx', import.meta.url), 'utf8');
const home = readFileSync(new URL('../app/(workspace)/learning/page.tsx', import.meta.url), 'utf8');

test('manager compliance is discoverable and admin-gated', () => {
  assert.match(home, /href="\/learning\/compliance"/);
  assert.match(page, /hasLearningAdmin/);
  assert.match(page, /withBrandTransaction/);
  assert.match(page, /tenantId: context\.tenantId/);
  assert.match(page, /Manager compliance/);
});

test('dashboard renders overdue and credential-risk evidence from the canonical read model', () => {
  assert.match(page, /loadLearningComplianceDashboard/);
  assert.match(page, /overdueEnrollments/);
  assert.match(page, /credentialsAtRisk/);
  assert.match(page, /Renewal or expiry within 30 days/);
  assert.match(page, /dashboard\.generatedAt/);
  assert.doesNotMatch(page, /mock|fixture|setTimeout/i);
});
