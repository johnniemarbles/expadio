import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRAND_HOST,
  PLATFORM_HOST,
  SHELL_NAVIGATION,
  assertBrandNavIsNotInsidePlatform,
  assertPlatformPayloadHasNoCustomerPii,
  hostForAudience,
  platformSafeRef,
} from '../src/index.ts';

test('hosts follow audience, not package folder names', () => {
  assert.equal(hostForAudience('platform'), PLATFORM_HOST);
  assert.equal(hostForAudience('brand'), BRAND_HOST);
  assert.doesNotMatch(PLATFORM_HOST, /platform-web|brand-web|tenant/);
  assert.doesNotMatch(BRAND_HOST, /platform-web|brand-web|tenant/);
});

test('platform safe ref keeps ids and drops customer fields', () => {
  const ref = platformSafeRef({ tenant: 'T-1048', brand: 'B-0001', correlation: 'corr-cs104-in', caseId: 'CS-104' });
  assert.deepEqual(Object.keys(ref).sort(), ['brand', 'caseId', 'correlation', 'tenant']);
  assertPlatformPayloadHasNoCustomerPii(ref);
  assert.throws(() => assertPlatformPayloadHasNoCustomerPii({ ...ref, email: 'a@b.invalid' }), /PLATFORM_PII_BOUNDARY/);
  assert.throws(() => assertPlatformPayloadHasNoCustomerPii({ name: 'Asha Reddy' }), /PLATFORM_PII_BOUNDARY/);
});

test('Customers is Brand-only navigation', () => {
  assertBrandNavIsNotInsidePlatform();
  assert.equal(SHELL_NAVIGATION.brand.includes('Customers'), true);
  assert.equal(SHELL_NAVIGATION.platform.includes('Customers'), false);
});
