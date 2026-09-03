import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const register = read('../app/api/learning/content-assets/route.ts');
const upload = read('../app/api/learning/content-assets/[id]/upload/route.ts');
const scan = read('../app/api/platform/content-assets/[id]/scan/route.ts');
const grant = read('../app/api/learning/content-assets/[id]/read-grant/route.ts');
const services = read('../lib/content-asset-services.ts');

test('content asset routes derive immutable scope from authenticated context', () => {
  for (const source of [register, upload, scan, grant]) {
    assert.match(source, /resolveRequestContext\(request\)/);
    assert.match(source, /withTenantTransaction\(context/);
    assert.match(source, /Cache-Control|contentAssetJson/);
  }
  assert.match(register, /tenantId: context\.tenantId/);
  assert.match(register, /organizationId: context\.organizationId!/);
  assert.match(register, /requestedBySubjectId: context\.subjectId/);
  assert.doesNotMatch(register, /tenantId: body\./);
  assert.doesNotMatch(register, /organizationId: body\./);
  assert.match(register, /purpose: 'LEARNING_CONTENT'/);
});

test('upload authorizes before buffering and enforces a bounded declared length', () => {
  const authorization = upload.indexOf('hasLearningAuthoringRole');
  const buffer = upload.indexOf('request.arrayBuffer()');
  assert.ok(authorization > -1 && buffer > authorization);
  assert.match(upload, /MAX_ROUTE_BYTES = 100 \* 1024 \* 1024/);
  assert.match(upload, /bytes\.byteLength !== declared/);
  assert.match(upload, /uploadContentAsset/);
});

test('scan caller cannot inject a verdict and quarantine commits separately', () => {
  assert.match(scan, /quarantineContentAssetForScan/);
  assert.match(scan, /resolveQuarantinedContentAssetScan/);
  assert.equal((scan.match(/withTenantTransaction\(context/g) ?? []).length, 2);
  assert.doesNotMatch(scan, /request\.json/);
  assert.doesNotMatch(scan, /body\.verdict|verdict:/);
  assert.match(scan, /service:content-asset-scanner/);
});

test('read grants are authoring-only and use the available-only runtime', () => {
  assert.match(grant, /hasLearningAuthoringRole/);
  assert.match(grant, /issueContentAssetReadGrant/);
  assert.match(grant, /learning\.authoring-preview/);
});

test('provider credentials stay in the Platform node composition root', () => {
  assert.match(services, /EXPADIO_CONTENT_ASSET_STORAGE_TOKEN/);
  assert.match(services, /EXPADIO_CONTENT_ASSET_SCANNER_TOKEN/);
  assert.match(services, /Platform-only composition root/);
  for (const source of [register, upload, scan, grant]) {
    assert.doesNotMatch(source, /process\.env|STORAGE_TOKEN|SCANNER_TOKEN/);
  }
});
