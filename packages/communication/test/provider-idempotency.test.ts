import assert from 'node:assert/strict';
import test from 'node:test';
import { tenantProviderIdempotencyKey } from '../src/provider-idempotency.ts';

test('provider keys separate brands and preserve deterministic retries', () => {
  const key = tenantProviderIdempotencyKey('brand-a', 'welcome-1');
  assert.equal(tenantProviderIdempotencyKey('brand-a', 'welcome-1'), key);
  assert.notEqual(tenantProviderIdempotencyKey('brand-b', 'welcome-1'), key);
  assert.notEqual(tenantProviderIdempotencyKey('brand-a', 'welcome-2'), key);
  assert.notEqual(tenantProviderIdempotencyKey('a:b', 'c'), tenantProviderIdempotencyKey('a', 'b:c'));
  assert.match(key, /^expadio:tenant:v1:[a-f0-9]{64}$/);
  assert.ok(tenantProviderIdempotencyKey('brand-a', 'x'.repeat(1000)).length <= 256);
  assert.doesNotMatch(key, /brand-a|welcome-1/);
});

test('empty or unstable identity cannot create a provider key', () => {
  for (const [tenant, key] of [['', 'key'], ['tenant', ''], [' tenant', 'key'], ['tenant', 'key ']]) {
    assert.throws(() => tenantProviderIdempotencyKey(tenant!, key!), /INPUT_INVALID/);
  }
});
