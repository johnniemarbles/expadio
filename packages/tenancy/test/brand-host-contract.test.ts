import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRAND_FALLBACK_PREFIX,
  BRAND_HOST,
  BRAND_PUBLIC_ORIGIN,
  PLATFORM_HOST,
  brandHostStatus,
  brandPublicPath,
  isBrandProductHost,
  isPlatformProductHost,
} from '../src/hosts.ts';

test('Brand product host is app.expadio.com, not the Railway fallback host', () => {
  assert.equal(BRAND_HOST, 'app.expadio.com');
  assert.equal(BRAND_PUBLIC_ORIGIN, 'https://app.expadio.com');
  assert.equal(BRAND_FALLBACK_PREFIX, '/brand');
  assert.equal(isBrandProductHost('https://app.expadio.com/brand'), true);
  assert.equal(isBrandProductHost('expadioplatform-web-production.up.railway.app'), false);
  assert.equal(isPlatformProductHost(PLATFORM_HOST), true);
});

test('fallback /brand paths map to Brand origin root', () => {
  assert.equal(brandPublicPath('/brand'), '/');
  assert.equal(brandPublicPath('/brand/api/customers'), '/api/customers');
  assert.equal(brandPublicPath('/api/brand/customers'), '/api/brand/customers');
});

test('host status stays undeployed until app.expadio.com serves Brand', () => {
  const status = brandHostStatus('expadioplatform-web-production.up.railway.app');
  assert.equal(status.deployed, false);
  assert.equal(status.currentIsProductHost, false);
  assert.equal(status.currentIsFallback, true);
  assert.equal(status.publicOrigin, 'https://app.expadio.com');
});
