import assert from 'node:assert/strict';
import test from 'node:test';
import {
  brandErrorResponse,
  membershipsFromRows,
  parseBrandProductScope,
  platformJourneyCorrelationBody,
} from '../lib/brand-host-runtime.ts';
import { BrandHostError } from '@expadio/tenancy';

test('Brand product scope accepts T/B/L codes and ALL', () => {
  const scope = parseBrandProductScope(new URL('https://app.expadio.com/brand/api/customers?tenant=T-1048&brand=B-0001&location=ALL'));
  assert.equal(scope.audience, 'brand');
  assert.equal(scope.tenant.state === 'resolved' && scope.tenant.value, 'T-1048');
  assert.equal(scope.brand.state === 'resolved' && scope.brand.value, 'B-0001');
  assert.equal(scope.location.state === 'resolved' && scope.location.value.kind, 'all-permitted');
});

test('account/org lab selectors are refused on the Brand path', () => {
  assert.throws(
    () => parseBrandProductScope(new URL('https://platform.expadio.com/brand/api/customers?tenant=T-1048&brand=B-0001&location=ALL&account=10000000-0000-0000-0000-000000000001')),
    (error: unknown) => error instanceof BrandHostError && error.code === 'LAB_SCOPE_NOT_ACCEPTED',
  );
});

test('missing product codes fail closed', () => {
  assert.throws(
    () => parseBrandProductScope(new URL('https://app.expadio.com/brand/api/customers?tenant=T-1048&brand=B-0001')),
    (error: unknown) => error instanceof BrandHostError && error.code === 'EXPLICIT_SCOPE_REQUIRED',
  );
});

test('SELECTED membership rows stay restricted', () => {
  const memberships = membershipsFromRows([
    {
      tenant_id: '10000000-0000-0000-0000-000000000001',
      organization_id: '20000000-0000-0000-0000-000000000001',
      workspace_scope_mode: 'ALL',
      operating_unit_scope_mode: 'SELECTED',
    },
  ]);
  assert.deepEqual(memberships[0]?.operatingUnitIds, []);
  assert.equal(memberships[0]?.workspaceIds, undefined);
});

test('Brand errors do not leak internals', async () => {
  const response = brandErrorResponse(new Error('password=secret schema=internal'));
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /password|schema/);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('journey writes and email correlations are refused', async () => {
  const write = brandErrorResponse(new Error('BRAND_JOURNEY_MUTATION_FORBIDDEN'));
  assert.equal(write.status, 405);
  assert.equal(write.headers.get('allow'), 'GET');
  const invalid = brandErrorResponse(new Error('INVALID_JOURNEY_CORRELATION'));
  assert.equal(invalid.status, 400);
  assert.throws(() => platformJourneyCorrelationBody('ada@northstar.test'));
  const body = platformJourneyCorrelationBody(null);
  assert.equal(body.correlation, 'CS-104');
  assert.equal(body.caseId, undefined);
});
