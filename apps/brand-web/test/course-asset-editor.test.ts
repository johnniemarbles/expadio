import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const editor = read('../components/CourseAssetEditor.tsx');
const detail = read('../app/(workspace)/learning/courses/[id]/page.tsx');
const proxy = read('../lib/platform-content-asset-proxy.ts');
const proxyRoute = read('../app/api/learning/content-assets/[...path]/route.ts');
const draftRoute = read('../app/api/learning/courses/[id]/versions/[version]/route.ts');
const platformRegistration = read('../../platform-web/app/api/learning/content-assets/route.ts');

test('Brand course draft exposes a real asset workflow only to administrators', () => {
  assert.match(detail, /value\.admin \? <section/);
  assert.match(detail, /CourseAssetEditor/);
  assert.match(editor, /version\.state === 'DRAFT'/);
  for (const operation of ['REGISTERING', 'UPLOADING', 'SCANNING', 'QUARANTINED', 'AVAILABLE', 'REJECTED', 'SAVING']) {
    assert.match(editor, new RegExp(operation));
  }
  assert.doesNotMatch(editor, /setTimeout\([^)]*AVAILABLE|mock|fixture/i);
});

test('Brand owns workflow but never receives provider credentials', () => {
  assert.match(proxy, /resolveBrandContext/);
  assert.match(proxy, /hasLearningAdmin/);
  assert.match(proxy, /EXPADIO_PLATFORM_API_URL/);
  assert.match(proxy, /target\.searchParams\.set\('account', context\.tenantId\)/);
  assert.match(proxy, /target\.searchParams\.set\('org', context\.organizationId\)/);
  assert.match(proxy, /redirect: 'error'/);
  assert.doesNotMatch(editor + proxy + proxyRoute, /STORAGE_TOKEN|SCANNER_TOKEN|SUPABASE/);
});

test('attachment waits for AVAILABLE and persists a canonical versioned block', () => {
  assert.match(editor, /asset\.state !== 'AVAILABLE'/);
  assert.match(editor, /schemaVersion: 1, blocks/);
  assert.match(editor, /assetId/);
  assert.match(editor, /LESSON_CONTENT_MIGRATION_REQUIRED/);
  assert.match(draftRoute, /replaceLearningCourseDraft/);
  assert.match(draftRoute, /withBrandTransaction/);
});

test('Platform, not Brand, chooses residency, compliance and retention policy', () => {
  assert.match(platformRegistration, /configuredContentAssetPolicy/);
  assert.match(platformRegistration, /retentionPolicy: policy\.retentionPolicy/);
  assert.match(platformRegistration, /requiredResidencyTags: policy\.requiredResidencyTags/);
  assert.doesNotMatch(platformRegistration, /retentionPolicy: body\./);
  assert.doesNotMatch(platformRegistration, /requiredResidencyTags: body\./);
});
