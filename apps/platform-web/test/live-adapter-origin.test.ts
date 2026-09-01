import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePlatformSelfOrigin } from '../lib/self-origin.ts';

test('Railway service domain wins over generic public app URL', () => {
  assert.equal(
    resolvePlatformSelfOrigin({
      railwayPublicDomain: 'expadio-production.up.railway.app',
      fallbackPublicUrl: 'https://brand.example.com',
      nodeEnv: 'production',
    }),
    'https://expadio-production.up.railway.app',
  );
});

test('current forwarded host wins when Railway domain is unavailable', () => {
  assert.equal(
    resolvePlatformSelfOrigin({
      forwardedHost: 'platform.expadio.com',
      forwardedProto: 'https',
      fallbackPublicUrl: 'https://brand.expadio.com',
      nodeEnv: 'production',
    }),
    'https://platform.expadio.com',
  );
});

test('forwarded protocol and local development ports are preserved', () => {
  assert.equal(
    resolvePlatformSelfOrigin({
      forwardedHost: 'localhost:3000',
      forwardedProto: 'http',
      nodeEnv: 'development',
    }),
    'http://localhost:3000',
  );
});

test('generic public URL is only a safe fallback', () => {
  assert.equal(
    resolvePlatformSelfOrigin({
      fallbackPublicUrl: 'https://platform.example.com/some/path',
      nodeEnv: 'production',
    }),
    'https://platform.example.com',
  );
  assert.equal(
    resolvePlatformSelfOrigin({
      fallbackPublicUrl: 'javascript:alert(1)',
      nodeEnv: 'production',
    }),
    null,
  );
});
