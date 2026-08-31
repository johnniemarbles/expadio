import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRAND_HOST,
  PLATFORM_HOST,
  PLATFORM_SAFE_ERROR_MESSAGE,
  REDACTED_ADDR,
  REDACTED_TEL,
  SHELL_NAVIGATION,
  assertBrandNavIsNotInsidePlatform,
  assertPlatformLogHasNoCustomerPii,
  assertPlatformPayloadHasNoCustomerPii,
  assertPlatformSendingHealthPayload,
  classifyRequestPath,
  hostForAudience,
  platformSafeErrorBody,
  platformSafeLogLine,
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
  assert.equal(classifyRequestPath('/api/communications/health'), 'platform-product');
  assert.equal(classifyRequestPath('/api/communications/overview'), 'platform-product');
  assert.equal(classifyRequestPath('/brand/api/customers'), 'brand');
  assert.equal(classifyRequestPath('/brand/api/journey'), 'brand');
  assert.equal(classifyRequestPath('/api/crm/contacts'), 'lab');
  assert.equal(classifyRequestPath('/tenant'), 'lab');
});

test('platform errors and logs stay generic', () => {
  assert.equal(platformSafeErrorBody().message, PLATFORM_SAFE_ERROR_MESSAGE);
  assert.doesNotMatch(platformSafeErrorBody('INTERNAL_ERROR').message, /email|phone|stack|SELECT/i);
  assert.equal(redactCustomerPii('contact a@b.invalid at +14155550100'), `contact ${REDACTED_ADDR} at ${REDACTED_TEL}`);
  assert.doesNotMatch(REDACTED_ADDR, /email|phone|full_name/i);
  assert.doesNotMatch(REDACTED_TEL, /email|phone|full_name/i);
  assert.throws(() => assertPlatformLogHasNoCustomerPii('failed for a@b.invalid'), /PLATFORM_PII_LOG_BOUNDARY/);
  assert.doesNotThrow(() => assertPlatformLogHasNoCustomerPii('Overview API Error INTERNAL_ERROR'));
  assert.doesNotThrow(() => assertPlatformLogHasNoCustomerPii(`retry ${REDACTED_ADDR}`));
  assert.equal(platformSafeLogLine('retry CS-104 tenant T-1048'), 'retry CS-104 tenant T-1048');
  assert.equal(platformSafeLogLine('bounce a@b.invalid'), `bounce ${REDACTED_ADDR}`);
  assert.throws(() => platformSafeLogLine('dump full_name=Ada'), /PLATFORM_PII_LOG_BOUNDARY/);
});

test('sending health may name a channel but not a recipient', () => {
  assert.doesNotThrow(() =>
    assertPlatformSendingHealthPayload({
      channels: [{ channel: 'email', total: 3, delivered: 2, failed: 1 }],
      recentDeliveries: [{ id: 'd1', channel: 'sms', state: 'FAILED', connectorKey: 'twilio' }],
    }),
  );
  assert.throws(
    () => assertPlatformSendingHealthPayload({ recipient: 'a@b.invalid' }),
    /PLATFORM_PII_BOUNDARY/,
  );
  assert.throws(
    () => assertPlatformSendingHealthPayload({ channel: 'email', to_address: 'a@b.invalid' }),
    /PLATFORM_PII_BOUNDARY/,
  );
  assert.throws(
    () => assertPlatformSendingHealthPayload({ note: 'bounce a@b.invalid' }),
    /PLATFORM_PII_BOUNDARY/,
  );
});
