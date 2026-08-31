import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRAND_HOST,
  PLATFORM_HOST,
  PLATFORM_SAFE_ERROR_MESSAGE,
  SHELL_NAVIGATION,
  assertBrandNavIsNotInsidePlatform,
  assertPlatformLogHasNoCustomerPii,
  assertPlatformPayloadHasNoCustomerPii,
  classifyRequestPath,
  hostForAudience,
  platformSafeErrorBody,
  platformSafeRef,
  redactCustomerPii,
} from '../src/index.ts';

test('hosts follow audience, not package folder names', () => {
  assert.equal(hostForAudience('platform'), PLATFORM_HOST);
  assert.equal(hostForAudience('brand'), BRAND_HOST);
  assert.doesNotMatch(PLATFORM_HOST, /platform-web|brand-web|tenant/);
  assert.doesNotMatch(BRAND_HOST, /platform-web|brand-web|tenant/);
});

test('platform safe ref keeps ids and drops customer fields', () => {
  const ref = platformSafeRef({ tenant: 'T-1048', brand: 'B-0001', correlation: 'CS-104', caseId: 'CS-104' });
  assert.deepEqual(Object.keys(ref).sort(), ['brand', 'caseId', 'correlation', 'tenant']);
  assertPlatformPayloadHasNoCustomerPii(ref);
  assert.throws(() => assertPlatformPayloadHasNoCustomerPii({ ...ref, email: 'a@b.invalid' }), /PLATFORM_PII_BOUNDARY/);
  assert.throws(() => assertPlatformPayloadHasNoCustomerPii({ full_name: 'hidden' }), /PLATFORM_PII_BOUNDARY/);
  assert.doesNotThrow(() => assertPlatformPayloadHasNoCustomerPii({ organization: { name: 'Dreamware Platform' } }));
});

test('Customers is Brand-only navigation', () => {
  assertBrandNavIsNotInsidePlatform();
  assert.equal(SHELL_NAVIGATION.brand.includes('Customers'), true);
  assert.equal(SHELL_NAVIGATION.platform.includes('Customers'), false);
});

test('request paths split product, brand and lab', () => {
  assert.equal(classifyRequestPath('/api/overview'), 'platform-product');
  assert.equal(classifyRequestPath('/api/workspaces'), 'platform-product');
  assert.equal(classifyRequestPath('/api/journey-correlation'), 'platform-product');
  assert.equal(classifyRequestPath('/brand/api/customers'), 'brand');
  assert.equal(classifyRequestPath('/brand/api/journey'), 'brand');
  assert.equal(classifyRequestPath('/api/crm/contacts'), 'lab');
  assert.equal(classifyRequestPath('/tenant'), 'lab');
});

test('platform errors and logs stay generic', () => {
  assert.equal(platformSafeErrorBody().message, PLATFORM_SAFE_ERROR_MESSAGE);
  assert.doesNotMatch(platformSafeErrorBody('INTERNAL_ERROR').message, /email|phone|stack|SELECT/i);
  assert.equal(redactCustomerPii('contact a@b.invalid at +14155550100'), 'contact [redacted-email] at [redacted-phone]');
  assert.throws(() => assertPlatformLogHasNoCustomerPii('failed for a@b.invalid'), /PLATFORM_PII_LOG_BOUNDARY/);
  assert.doesNotThrow(() => assertPlatformLogHasNoCustomerPii('Overview API Error INTERNAL_ERROR'));
});
