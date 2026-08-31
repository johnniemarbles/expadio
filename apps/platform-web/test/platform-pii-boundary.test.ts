import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  PLATFORM_JOURNEY_CORRELATION_ROUTE,
  SHELL_NAVIGATION,
  classifyRequestPath,
} from '@expadio/tenancy';
import { SHELL_PLATFORM_SECTIONS, assertPlatformSectionsMatchContract } from '../lib/platform-product-surface.ts';

test('Platform product nav matches the shared contract and excludes lab surfaces', () => {
  assertPlatformSectionsMatchContract();
  assert.deepEqual(
    SHELL_PLATFORM_SECTIONS.map((section) => section.label),
    [...SHELL_NAVIGATION.platform],
  );
  for (const section of SHELL_PLATFORM_SECTIONS) {
    assert.notEqual(classifyRequestPath(section.href), 'lab');
    assert.notEqual(classifyRequestPath(section.href), 'brand');
    assert.doesNotMatch(section.href, /\/crm|\/gtm|\/dentex|\/vendors|\/expenses|\/brand|\/tenant/);
  }
});

test('product API sources refuse lab dump and raw error leakage', () => {
  const workspaces = readFileSync(new URL('../app/api/workspaces/route.ts', import.meta.url), 'utf8');
  assert.match(workspaces, /SHELL_PLATFORM_SECTIONS/);
  assert.match(workspaces, /assertPlatformProductPayload/);
  assert.match(workspaces, /platformProductDenied/);
  assert.doesNotMatch(workspaces, /href: '\/crm'|href: '\/gtm'|href: '\/dentex'|href: '\/vendors'|href: '\/expenses'/);
  assert.doesNotMatch(workspaces, /User is not authenticated/);
  const overview = readFileSync(new URL('../app/api/overview/route.ts', import.meta.url), 'utf8');
  assert.match(overview, /assertPlatformProductPayload/);
  assert.match(overview, /platformProductDenied|PLATFORM_SAFE_ERROR_MESSAGE/);
  assert.doesNotMatch(overview, /message: error\.message/);
  const context = readFileSync(new URL('../app/api/context/route.ts', import.meta.url), 'utf8');
  assert.match(context, /assertPlatformProductPayload/);
  assert.match(context, /platformProductDenied|PLATFORM_SAFE_ERROR_MESSAGE/);
  assert.doesNotMatch(context, /message: error\.message/);
  const journey = readFileSync(new URL('../app/api/journey-correlation/route.ts', import.meta.url), 'utf8');
  assert.match(journey, /assertPlatformPayloadHasNoCustomerPii/);
  assert.match(journey, /platformProductDenied/);
  assert.doesNotMatch(journey, /export async function POST/);
  assert.equal(classifyRequestPath(PLATFORM_JOURNEY_CORRELATION_ROUTE), 'platform-product');
});

test('sending-health product APIs scan operational payloads and stay private', () => {
  const health = readFileSync(new URL('../app/api/communications/health/route.ts', import.meta.url), 'utf8');
  assert.match(health, /assertPlatformProductSendingHealth/);
  assert.match(health, /PLATFORM_PRODUCT_CACHE/);
  assert.doesNotMatch(health, /metadata:/);
  // Source scan includes comments. Do not name address-field tokens in this route.
  assert.doesNotMatch(health, /recipient|to_address|from_address/);
  const commsOverview = readFileSync(new URL('../app/api/communications/overview/route.ts', import.meta.url), 'utf8');
  assert.match(commsOverview, /assertPlatformProductSendingHealth/);
  assert.match(commsOverview, /PLATFORM_PRODUCT_CACHE/);
  assert.match(commsOverview, /writePlatformProductLog/);
  assert.doesNotMatch(commsOverview, /console\.error\("Communications overview API error:"/);
  assert.doesNotMatch(commsOverview, /recipient_key/);
});
