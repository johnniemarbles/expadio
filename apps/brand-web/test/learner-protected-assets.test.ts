import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const player = readFileSync(new URL('../app/(workspace)/learn/[id]/page.tsx', import.meta.url), 'utf8');
const asset = readFileSync(new URL('../components/ProtectedLessonAsset.tsx', import.meta.url), 'utf8');
const proxy = readFileSync(new URL('../app/api/learning/assets/read-grant/route.ts', import.meta.url), 'utf8');

test('player renders governed media through the protected asset component', () => {
  assert.match(player, /ProtectedLessonAsset/);
  assert.match(player, /enrollmentId={enrollmentId}/);
  assert.match(player, /lessonId={lessonId}/);
  assert.match(player, /assetId={data\.assetId}/);
  assert.doesNotMatch(player, /src={data\.assetId}/);
});

test('protected renderer requests a grant only on learner action', () => {
  assert.match(asset, /fetch\('\/api\/learning\/assets\/read-grant'/);
  assert.match(asset, /method: 'POST'/);
  assert.match(asset, /if \(!url\)/);
  assert.match(asset, /<video controls/);
  assert.match(asset, /<audio controls/);
  assert.match(asset, /rel="noreferrer"/);
});

test('Brand proxy forwards authenticated workspace context without storage credentials', () => {
  assert.match(proxy, /resolveBrandContext\(\)/);
  assert.match(proxy, /target\.searchParams\.set\('account', context\.tenantId\)/);
  assert.match(proxy, /target\.searchParams\.set\('org', context\.organizationId\)/);
  assert.match(proxy, /redirect: 'error'/);
  assert.doesNotMatch(proxy, /STORAGE_TOKEN|SUPABASE|bucket/i);
});
